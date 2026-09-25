import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { McpPendingAction, Prisma } from "@prisma/client";
import { prismaRaw } from "@/lib/prisma";
import { mcpAuditData } from "./audit";
import { McpActionError } from "./errors";
import type { McpPrincipal } from "./auth";
import { isBusinessAllowed } from "./auth";
import { CONSUMABLE_STATUSES } from "./classification";

/* ═══════════════════════════════════════════════════════════════
   NEXUP MCP — pending-action core (Phase 2B v1)

   Generic infrastructure for Red (confirmation-gated) actions:

     prepare_*  → createPendingAction(): validates caller-side,
                  persists a server-side intent snapshot (args +
                  computed preview + precondition fingerprint) and a
                  PREPARE audit row in one transaction, and returns a
                  256-bit one-time token exactly once.
     confirm_*  → runConfirmedAction(): consumes the pending row,
                  re-checks preconditions, executes the business
                  mutation and writes the business audit row — all
                  inside ONE Prisma transaction. Any failure rolls the
                  whole thing back, leaving the action non-executed.

   Security properties (v1):
   • Only the token's SHA-256 is stored; the plaintext is never
     logged, audited or persisted anywhere.
   • The token proves same-agent continuation, NOT human approval —
     the agent sees it too. Human confirmation in v1 happens at the
     conversational layer; a trusted approval channel can add a real
     APPROVED state later (columns pre-declared, CONSUMABLE_STATUSES).
   • v1 requires the SAME principal to prepare and confirm
     (row.actor === principal.id); maker-checker is a future extension.
   • Expiry is 10 minutes. Replay, wrong token, expiry, concurrent
     confirmation and precondition drift all fail closed with nothing
     written to business tables.
   ═══════════════════════════════════════════════════════════════ */

/** How long a prepared intent stays confirmable. */
export const PENDING_ACTION_TTL_MS = 10 * 60 * 1000;

/** Max wrong-token attempts before the pending action is invalidated. */
export const MAX_TOKEN_ATTEMPTS = 3;

/** Everything a Red action's prepare step must hand to the core. */
export type PendingActionSpec = {
  /** Business tool that will execute (e.g. "create_client_payment"). */
  tool: string;
  actionType: "CREATE" | "UPDATE" | "DELETE";
  entityType: string;
  entityId?: string;
  /** The single business this action touches (allow-list checked by caller). */
  business: { id: string; slug: string };
  /** Validated, canonical, non-secret arguments — executed as-is at confirm. */
  argsSnapshot: Prisma.InputJsonValue;
  /** Computed effect for the human-readable summary (no secrets). */
  preview: Prisma.InputJsonValue;
  /** One-paragraph human-readable summary the agent must show the user. */
  summary: string;
  /**
   * Preconditions re-checked inside the confirm transaction, keyed
   * "Model:id" → { field: expectedValue }. Use stable serializations
   * (ISO strings for dates, String(decimal) for amounts).
   */
  preconditionFingerprint?: Prisma.InputJsonValue;
};

export type PrepareResult = {
  confirmationId: string;
  /** One-time token — returned exactly once, never stored in plaintext. */
  token: string;
  expiresAt: Date;
  summary: string;
  preview: Prisma.InputJsonValue;
};

/** SHA-256 of the canonical args JSON — integrity/diagnostics only. */
export function requestHashOf(argsSnapshot: unknown): string {
  return createHash("sha256").update(stableStringify(argsSnapshot), "utf8").digest("hex");
}

function tokenHashOf(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function tokenMatches(providedToken: string, storedHash: string): boolean {
  const a = createHash("sha256").update(providedToken, "utf8").digest();
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Deterministic JSON (sorted keys) so hashes and comparisons are stable. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

/**
 * Persist the intent + its PREPARE audit row (one transaction) and
 * return the confirmation reference and the one-time token.
 */
export async function createPendingAction(
  principal: McpPrincipal,
  spec: PendingActionSpec,
): Promise<PrepareResult> {
  const token = randomBytes(32).toString("base64url"); // 256-bit
  const expiresAt = new Date(Date.now() + PENDING_ACTION_TTL_MS);

  const created = await prismaRaw.$transaction(async (tx) => {
    const row = await tx.mcpPendingAction.create({
      data: {
        actor: principal.id,
        actorName: principal.displayName,
        tool: spec.tool,
        actionType: spec.actionType,
        entityType: spec.entityType,
        entityId: spec.entityId ?? null,
        businessId: spec.business.id,
        businessSlug: spec.business.slug,
        argsSnapshot: spec.argsSnapshot,
        preview: spec.preview,
        preconditionFingerprint:
          spec.preconditionFingerprint !== undefined ? spec.preconditionFingerprint : undefined,
        requestHash: requestHashOf(spec.argsSnapshot),
        confirmTokenHash: tokenHashOf(token),
        status: "PENDING",
        expiresAt,
      },
    });

    // PREPARE is audited: a prepared-but-never-confirmed financial
    // intent is exactly what an audit trail exists for. The token
    // itself is NEVER part of audit metadata.
    await tx.mcpAuditLog.create({
      data: mcpAuditData({
        principal,
        tool: spec.tool,
        action: "PREPARE",
        entityType: "McpPendingAction",
        entityId: row.id,
        business: spec.business,
        metadata: {
          summary: spec.summary,
          preview: spec.preview,
          requestHash: row.requestHash,
          expiresAt: expiresAt.toISOString(),
        },
      }),
    });

    return row;
  });

  return {
    confirmationId: created.id,
    token,
    expiresAt: created.expiresAt,
    summary: spec.summary,
    preview: spec.preview,
  };
}

/** What the Red action implementation provides for the confirm call. */
export type ConfirmExecution<R> = {
  /**
   * Execute the business mutation from the SERVER-SIDE snapshot and
   * return the result plus the business audit row to insert. Runs
   * inside the confirm transaction — after the pending row has been
   * atomically consumed and preconditions have been re-checked. Any
   * throw rolls back consumption, mutation and audit together.
   */
  execute: (
    tx: Prisma.TransactionClient,
    pending: McpPendingAction,
  ) => Promise<{ data: R; audit: Prisma.McpAuditLogCreateInput }>;
};

export type ConfirmOutcome<R> = {
  confirmationId: string;
  auditLogId: string;
  result: R;
};

/**
 * Confirm + execute a pending Red action — fail-closed, one transaction:
 *
 *   (a) atomic consume: UPDATE … WHERE id = ? AND status IN (consumable)
 *       AND confirmTokenHash = ? AND expiresAt > now  → count 0 aborts;
 *   (b) precondition fingerprint re-check inside the transaction;
 *   (c) business mutation via execute(tx, pending);
 *   (d) business audit row insert + resultAuditLogId link.
 *
 * If (c) or (d) throws, the transaction rolls back INCLUDING the
 * consume: the pending action stays non-executed and no business data
 * changes. Wrong token / expiry / replay / concurrent confirm land on
 * the count-0 or pre-check paths and never reach the mutation.
 */
export async function runConfirmedAction<R>(opts: {
  principal: McpPrincipal;
  /** The confirm_* tool being called (authorization already checked). */
  confirmTool: string;
  /** The business tool recorded in the pending row — must match. */
  actionTool: string;
  confirmationId: string;
  token: string;
  execution: ConfirmExecution<R>;
}): Promise<ConfirmOutcome<R>> {
  const { principal, confirmTool, actionTool, confirmationId, token } = opts;

  if (!token || typeof token !== "string") {
    throw new McpActionError("confirmation_invalid", "A confirmation token is required.");
  }

  // ── pre-checks (nice errors; the authoritative gate is in the tx) ──
  const row = await prismaRaw.mcpPendingAction.findUnique({ where: { id: confirmationId } });
  if (!row) {
    throw new McpActionError("confirmation_invalid", "Unknown confirmation id — nothing was executed.");
  }
  if (row.tool !== actionTool) {
    throw new McpActionError(
      "confirmation_invalid",
      `This confirmation belongs to a different action ('${row.tool}') — nothing was executed.`,
    );
  }
  if (row.actor !== principal.id) {
    throw new McpActionError(
      "forbidden",
      "Only the MCP principal that prepared this action may confirm it (v1 rule).",
    );
  }
  if (!isBusinessAllowed(principal, row.businessSlug)) {
    throw new McpActionError(
      "forbidden",
      `This action targets business '${row.businessSlug}', which is not allowed for this MCP profile.`,
    );
  }
  if (row.status === "EXECUTED") {
    throw new McpActionError("confirmation_used", "This confirmation was already used — nothing further was executed.");
  }
  if (row.status === "EXPIRED") {
    throw new McpActionError("confirmation_expired", "This confirmation expired — prepare the action again.");
  }
  if (!CONSUMABLE_STATUSES.includes(row.status as (typeof CONSUMABLE_STATUSES)[number])) {
    // FAILED, APPROVED (future), or anything unexpected: not consumable in v1.
    throw new McpActionError(
      "confirmation_invalid",
      `This confirmation is not in a confirmable state (${row.status}) — nothing was executed.`,
    );
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    await markExpired(row.id);
    throw new McpActionError("confirmation_expired", "This confirmation expired — prepare the action again.");
  }

  // ── token check (constant-time; mismatch is fail-closed) ──
  if (!tokenMatches(token, row.confirmTokenHash)) {
    await recordFailedAttempt(row.id);
    throw new McpActionError(
      "confirmation_invalid",
      "Invalid confirmation token — nothing was executed. Ask for the action to be prepared again.",
    );
  }

  try {
    const result = await prismaRaw.$transaction(async (tx) => {
      // (a) authoritative consume — one conditional update decides.
      const consumed = await tx.mcpPendingAction.updateMany({
        where: {
          id: row.id,
          status: { in: [...CONSUMABLE_STATUSES] },
          confirmTokenHash: row.confirmTokenHash,
          expiresAt: { gt: new Date() },
        },
        data: { status: "EXECUTED", confirmedAt: new Date(), executedAt: new Date() },
      });
      if (consumed.count === 0) {
        // Lost a race, expired between pre-check and tx, or replayed.
        const fresh = await tx.mcpPendingAction.findUnique({ where: { id: row.id } });
        if (!fresh || fresh.status === "EXECUTED") {
          throw new McpActionError("confirmation_used", "This confirmation was already used — nothing further was executed.");
        }
        if (fresh.status === "EXPIRED" || fresh.expiresAt.getTime() <= Date.now()) {
          throw new McpActionError("confirmation_expired", "This confirmation expired — prepare the action again.");
        }
        throw new McpActionError("confirmation_invalid", "Confirmation could not be consumed — nothing was executed.");
      }

      // (b) preconditions re-checked INSIDE the transaction.
      await assertFingerprintUnchanged(tx, row.preconditionFingerprint);

      // (c) business mutation from the server-side snapshot…
      const { data, audit } = await opts.execution.execute(tx, row);

      // (d) …its business audit row, and the bidirectional link.
      const auditRow = await tx.mcpAuditLog.create({ data: audit });
      await tx.mcpPendingAction.update({
        where: { id: row.id },
        data: { resultAuditLogId: auditRow.id },
      });

      return { data, auditLogId: auditRow.id };
    });

    return { confirmationId: row.id, auditLogId: result.auditLogId, result: result.data };
  } catch (err) {
    // Precondition conflict: mark FAILED (best-effort, business-neutral)
    // so a stale confirmation can't linger as confirmable.
    if (err instanceof McpActionError && err.code === "conflict") {
      await markFailed(row.id);
    }
    throw err;
  }
}

/* ─── lifecycle markers (business-neutral, best-effort) ─────── */

async function markExpired(id: string): Promise<void> {
  try {
    await prismaRaw.mcpPendingAction.updateMany({
      where: { id, status: { in: [...CONSUMABLE_STATUSES] } },
      data: { status: "EXPIRED" },
    });
  } catch {
    /* lifecycle marker only — the in-transaction gates stay authoritative */
  }
}

async function markFailed(id: string): Promise<void> {
  try {
    await prismaRaw.mcpPendingAction.updateMany({
      where: { id, status: { in: [...CONSUMABLE_STATUSES] } },
      data: { status: "FAILED" },
    });
  } catch {
    /* best-effort only */
  }
}

async function recordFailedAttempt(id: string): Promise<void> {
  try {
    const updated = await prismaRaw.mcpPendingAction.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
    if (updated.attempts >= MAX_TOKEN_ATTEMPTS) {
      await markFailed(id);
    }
  } catch {
    /* best-effort only */
  }
}

/* ─── precondition fingerprint check ─────────────────────────── */

/**
 * Fingerprint format: { "Model:id": { field: expectedValue, … } }.
 * Values are compared after normalization (Date → ISO string,
 * Decimal-like objects → String()). A missing row or any drift throws
 * [conflict] so the confirm transaction rolls back atomically.
 */
async function assertFingerprintUnchanged(
  tx: Prisma.TransactionClient,
  fingerprint: Prisma.JsonValue | null,
): Promise<void> {
  if (fingerprint === null || fingerprint === undefined) return;
  if (typeof fingerprint !== "object" || Array.isArray(fingerprint)) {
    throw new McpActionError("invalid_input", "Malformed precondition fingerprint.");
  }

  for (const [key, expected] of Object.entries(fingerprint as Record<string, unknown>)) {
    const sep = key.indexOf(":");
    const model = key.slice(0, sep);
    const id = key.slice(sep + 1);
    if (!model || !id) {
      throw new McpActionError("invalid_input", `Malformed precondition key '${key}'.`);
    }

    const delegate = (tx as unknown as Record<string, { findUnique: (a: { where: { id: string } }) => Promise<Record<string, unknown> | null> }>)[
      lowercaseFirst(model)
    ];
    if (!delegate?.findUnique) {
      throw new McpActionError("invalid_input", `Unknown precondition model '${model}'.`);
    }

    const current = await delegate.findUnique({ where: { id } });
    if (!current) {
      throw new McpActionError(
        "conflict",
        `Precondition failed: ${model} ${id} no longer exists. Prepare the action again.`,
      );
    }

    if (typeof expected !== "object" || expected === null || Array.isArray(expected)) {
      throw new McpActionError("invalid_input", `Malformed precondition for '${key}'.`);
    }
    for (const [field, want] of Object.entries(expected as Record<string, unknown>)) {
      const actual = normalizeValue(current[field]);
      if (stableStringify(actual) !== stableStringify(normalizeValue(want))) {
        throw new McpActionError(
          "conflict",
          `Precondition failed: ${model} ${id} field '${field}' changed since this action was prepared. Prepare the action again.`,
        );
      }
    }
  }
}

/** Normalize DB values for comparison: Dates → ISO, Decimals → string. */
function normalizeValue(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && typeof (v as { toFixed?: unknown }).toFixed === "function") {
    return String(v); // Prisma Decimal
  }
  if (typeof v === "object" || Array.isArray(v)) {
    if (Array.isArray(v)) return v.map(normalizeValue);
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = normalizeValue(val);
    return out;
  }
  return v;
}

function lowercaseFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
