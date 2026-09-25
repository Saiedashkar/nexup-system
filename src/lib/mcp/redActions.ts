import type { McpPendingAction, Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { McpPrincipal } from "./auth";
import { isBusinessAllowed } from "./auth";
import { mcpAuditData } from "./audit";
import { McpActionError } from "./errors";
import {
  createPendingAction,
  runConfirmedAction,
} from "./pending";
import type { ConfirmExecution, ConfirmOutcome, PrepareResult } from "./pending";
import { recordClientPaymentInTx, PaymentValidationError, PaymentConflictError } from "@/lib/payments/recordClientPayment";
import type { CreateClientPaymentInput } from "./schemas";

/* ═══════════════════════════════════════════════════════════════
   NEXUP MCP — Red actions (Phase 2B): confirm-before-execute

   create_client_payment — record money INTO the pool. Money movement
   is the most sensitive surface MCP touches, so the tool never runs
   directly: prepare stages a validated intent + preview + fingerprint,
   and only a later confirm executes it — always through the shared
   pending-action core (pending.ts). No parallel confirmation
   mechanism is implemented here, by design.

   Mirrors src/app/api/client-payments/route.ts exactly:
   • overpayment guard: amount > remaining → reject;
   • deposit += amount, remaining = max(0, totalPrice − newDeposit),
     paymentStatus = FULL if remaining ≤ 0, PARTIAL if deposit > 0;
   • ClientPayment amount, optional date (default now), optional note;
   • PoolTransaction type IN, amountSAR = amount, note =
     `Payment: {client} — {project}{ (note)}` — SAR only: no withdrawal,
     no exchange rate, no profit-ledger behavior, no receipt;
   • tier: VIP if paid-in-full revenue > 1000 OR ≥ 3 projects,
     LOYAL if > 500 OR ≥ 2 projects, else NORMAL — always recomputed
     from aggregates (mirrors the existing app flow, never increments);
   • ActivityLog is NOT written: it requires a human User FK and MCP
     has none. The MCP business audit row is the execution audit.
   ═══════════════════════════════════════════════════════════════ */

/* ─── shared helpers ──────────────────────────────────────────── */

/** DB money shape → number for arithmetic (the app does the same). */
function toNumber(d: unknown): number {
  const n = Number(d);
  if (!Number.isFinite(n)) {
    throw new McpActionError("conflict", "Stored amount is not a finite number — refusing to compute.");
  }
  return n;
}

/** Round to cents exactly like the existing API route. */
function toCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The existing API stores `note || null` — trim/empty become null. */
function toNoteOrNull(note: string | null | undefined): string | null {
  if (note === undefined || note === null) return null;
  const trimmed = note.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The one business this action touches (allow-list checked here). */
async function resolveBusinessForRed(
  slug: string,
  principal: McpPrincipal,
): Promise<{ id: string; name: string; slug: string }> {
  if (!isBusinessAllowed(principal, slug)) {
    throw new McpActionError(
      "forbidden",
      `Business '${slug}' is not allowed for this MCP profile.`,
    );
  }
  const business = await prisma.business.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  });
  if (!business) {
    throw new McpActionError("not_found", `Business '${slug}' does not exist.`);
  }
  return business;
}

/**
 * Parse an ISO 8601 date, strictly — same rules as actions.ts:
 * `new Date("2026-02-31")` silently rolls over, so the calendar
 * components are round-tripped and compared instead of trusting
 * the constructor.
 */
function toRedDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) {
    throw new McpActionError("invalid_input", `Invalid date: '${value}'. Use ISO 8601, e.g. 2026-09-24.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 2000 || year > 2100) {
    throw new McpActionError("invalid_input", "Date year must be between 2000 and 2100.");
  }

  const probe = new Date(Date.UTC(year, month - 1, day));
  const isRealCalendarDate =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;

  if (!isRealCalendarDate) {
    throw new McpActionError(
      "invalid_input",
      `Invalid date: '${value}' is not a real calendar date (e.g. 2026-02-31 does not exist).`,
    );
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new McpActionError("invalid_input", `Invalid date: '${value}'. Use ISO 8601, e.g. 2026-09-24.`);
  }
  return parsed;
}

/* ─── context resolution (prepare) ────────────────────────────── */

type ResolvedPaymentContext = {
  business: { id: string; name: string; slug: string };
  client: { id: string; name: string; phone: string; tier: string; deletedAt: Date | null };
  project: {
    id: string;
    clientId: string;
    projectName: string;
    totalPrice: number;
    deposit: number;
    remaining: number;
    paymentStatus: string;
  };
};

/**
 * Load client + project through the soft-delete-aware client.
 * A soft-deleted client/project is invisible → not_found (fail-closed).
 * The business allow-list is checked first: a project id from another
 * business can never even be probed.
 */
async function resolvePaymentContext(
  input: z.infer<typeof CreateClientPaymentInput>,
  principal: McpPrincipal,
): Promise<ResolvedPaymentContext> {
  const business = await resolveBusinessForRed(input.business, principal);

  const project = await prisma.projectRecord.findFirst({
    where: { id: input.projectId, businessId: business.id },
    select: {
      id: true,
      clientId: true,
      projectName: true,
      totalPrice: true,
      deposit: true,
      remaining: true,
      paymentStatus: true,
      deletedAt: true,
      client: { select: { id: true, name: true, phone: true, tier: true, deletedAt: true } },
    },
  });

  if (!project) {
    throw new McpActionError(
      "not_found",
      `Project '${input.projectId}' was not found in business '${input.business}'. ` +
        "Prepare the payment against an existing project of this business.",
    );
  }

  const client = project.client;
  if (!client) {
    // Structurally impossible (ProjectRecord.client is required); kept
    // fail-closed so a future schema change can never weaken the gate.
    throw new McpActionError("conflict", "Payment context is incomplete — nothing was prepared.");
  }
  // The soft-delete extension does not filter nested relation selects,
  // so a deleted client is checked explicitly (fail-closed).
  if (client.deletedAt !== null) {
    throw new McpActionError(
      "not_found",
      "The project's client no longer exists — nothing was prepared.",
    );
  }

  return {
    business,
    client,
    project: {
      id: project.id,
      clientId: project.clientId,
      projectName: project.projectName,
      totalPrice: toNumber(project.totalPrice),
      deposit: toNumber(project.deposit),
      remaining: toNumber(project.remaining),
      paymentStatus: project.paymentStatus,
    },
  };
}

/* ─── create_client_payment — prepare ─────────────────────────── */

/**
 * Stage a client payment for later confirmation. Validates everything,
 * computes the effect, stores the server-side snapshot + fingerprint,
 * writes the PREPARE audit row, and returns token + human preview.
 * Performs NO business mutation — the only writes are the pending row
 * and its audit row, both inside the core's own transaction.
 */
export async function prepareCreateClientPayment(
  input: z.infer<typeof CreateClientPaymentInput>,
  principal: McpPrincipal,
): Promise<PrepareResult> {
  const { business, client, project } = await resolvePaymentContext(input, principal);

  const amount = input.amount;

  // Fail-closed backstop (the zod schema is the primary boundary):
  // NaN and ±Infinity slip past comparison operators, so they are
  // rejected explicitly, along with zero/negative amounts.
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new McpActionError(
      "invalid_input",
      "Amount must be a finite, positive SAR number with at most 2 decimal places.",
    );
  }

  // Overpayment guard — identical to the web app's API route.
  if (amount > project.remaining) {
    throw new McpActionError(
      "conflict",
      `Amount ${amount.toFixed(2)} SAR exceeds the project's remaining balance ` +
        `${project.remaining.toFixed(2)} SAR — nothing was prepared.`,
    );
  }

  const date = input.date ? toRedDate(input.date) : new Date();

  const newDeposit = toCents(project.deposit + amount);
  const newRemaining = toCents(Math.max(0, project.totalPrice - newDeposit));
  const newPaymentStatus = newRemaining <= 0 ? "FULL" : newDeposit > 0 ? "PARTIAL" : "UNPAID";

  // Preconditions re-checked inside the confirm transaction: the three
  // money fields and the client FK — any drift aborts with [conflict].
  // Serialized exactly the way the core's comparator normalizes the DB
  // side (Prisma Decimal → String() strips trailing zeros), so String()
  // of the number matches String() of the Decimal at confirm time.
  const fingerprint: Prisma.InputJsonValue = {
    [`ProjectRecord:${project.id}`]: {
      totalPrice: String(project.totalPrice),
      deposit: String(project.deposit),
      remaining: String(project.remaining),
      clientId: project.clientId,
    },
  };

  const argsSnapshot: Prisma.InputJsonValue = {
    projectId: project.id,
    amount, // exact caller value, stored server-side — confirm never re-asks
    date: date.toISOString(),
    note: toNoteOrNull(input.note),
    clientId: client.id,
    businessId: business.id,
  };

  const preview = {
    business: business.slug,
    client: {
      id: client.id,
      name: client.name,
      phone: client.phone,
      currentTier: client.tier,
    },
    project: { id: project.id, name: project.projectName },
    amountSAR: amount,
    paidBefore: toCents(project.deposit),
    remainingBefore: toCents(project.remaining),
    remainingAfter: newRemaining,
    paymentStatusAfter: newPaymentStatus,
  };

  const summary =
    `Record a client payment of ${amount.toFixed(2)} SAR from '${client.name}' ` +
    `on project '${project.projectName}'. Paid before: ${toCents(project.deposit).toFixed(2)} SAR. ` +
    `Remaining before: ${toCents(project.remaining).toFixed(2)} SAR → after: ${newRemaining.toFixed(2)} SAR. ` +
    (newRemaining <= 0 ? "This settles the project fully. " : "The project stays open. ") +
    "Confirm within 10 minutes with the token returned by this call.";

  return createPendingAction(principal, {
    tool: "create_client_payment",
    actionType: "CREATE",
    entityType: "ClientPayment",
    entityId: project.id,
    business: { id: business.id, slug: business.slug },
    argsSnapshot,
    preview,
    summary,
    preconditionFingerprint: fingerprint,
  });
}

/* ─── create_client_payment — confirm executor ────────────────── */

/** The executed state + the audit row, produced inside the tx. */
export type CreateClientPaymentResult = {
  paymentId: string;
  amountSAR: number;
  projectId: string;
  clientId: string;
  depositAfter: number;
  remainingAfter: number;
  paymentStatusAfter: string;
  clientTierAfter: string;
};

type PaymentExecution = {
  data: CreateClientPaymentResult;
  audit: Prisma.McpAuditLogCreateInput;
};

/**
 * The mutation + audit handed to runConfirmedAction. The financial
 * mutation is the SHARED primitive (the same code the web payment API
 * runs), executed from the server-side snapshot only — caller-supplied
 * financial values are never used. Terminal payment errors (missing/
 * deleted project or client, scope drift, overpayment, invalid amount)
 * and the CAS conflict are mapped to [conflict] so the PendingAction
 * fails closed (status FAILED) inside the same transaction. MCP never
 * retries: a conflict means the world moved on and the intent is stale.
 */
export function makeCreateClientPaymentExecution(
  principal: McpPrincipal,
): ConfirmExecution<PaymentExecution["data"]> {
  return {
    execute: async (
      tx: Prisma.TransactionClient,
      pending: McpPendingAction,
    ): Promise<PaymentExecution> => {
      // The snapshot is the ONLY source of financial truth here.
      const args = pending.argsSnapshot as {
        projectId: string;
        amount: number;
        date: string;
        note: string | null;
        clientId: string;
        businessId: string;
      };

      const date = new Date(args.date);
      if (Number.isNaN(date.getTime())) {
        throw new McpActionError("conflict", "Snapshot date is invalid — nothing was executed.");
      }

      let recorded;
      try {
        recorded = await recordClientPaymentInTx(tx, {
          projectRecordId: args.projectId,
          amount: args.amount,
          date,
          note: args.note,
          // MCP has no human User FK — the actor lives in the pending
          // action + MCP audit row, never in createdByUserId.
          createdByUserId: null,
          // Business scope re-asserted from the pending intent: a
          // project that moved businesses since prepare is refused.
          expectedBusinessId: args.businessId,
        });
      } catch (err) {
        if (err instanceof PaymentValidationError) {
          throw new McpActionError("conflict", `${paymentConflictMessages[err.code]} Prepare the payment again.`);
        }
        if (err instanceof PaymentConflictError) {
          throw new McpActionError(
            "conflict",
            "Project balance changed while confirming — nothing was executed. Prepare the payment again.",
          );
        }
        throw err;
      }

      // Exactly one MCP business audit row — the execution audit.
      const audit = mcpAuditData({
        principal,
        tool: "create_client_payment",
        action: "CREATE",
        entityType: "ClientPayment",
        entityId: recorded.paymentId,
        business: { id: args.businessId, slug: pending.businessSlug },
        metadata: {
          projectId: recorded.projectId,
          projectName: recorded.projectName,
          clientId: recorded.clientId,
          amountSAR: recorded.amount,
          paymentId: recorded.paymentId,
          depositAfter: recorded.depositAfter,
          remainingAfter: recorded.remainingAfter,
          paymentStatusAfter: recorded.paymentStatusAfter,
          clientTierAfter: recorded.clientTierAfter,
          poolTransaction: "IN",
          currency: "SAR",
          pendingActionId: pending.id,
        },
      });

      return {
        data: {
          paymentId: recorded.paymentId,
          amountSAR: recorded.amount,
          projectId: recorded.projectId,
          clientId: recorded.clientId,
          depositAfter: recorded.depositAfter,
          remainingAfter: recorded.remainingAfter,
          paymentStatusAfter: recorded.paymentStatusAfter,
          clientTierAfter: recorded.clientTierAfter,
        },
        audit,
      };
    },
  };
}

/** Confirm-time terminal payment failures, in agent-facing language. */
const paymentConflictMessages: Record<string, string> = {
  PAYMENT_NOT_FOUND: "The project or its client no longer exists — nothing was executed.",
  PAYMENT_OVERPAYMENT: "The remaining balance changed and no longer covers this amount — nothing was executed.",
  PAYMENT_INVALID_AMOUNT: "The staged amount is invalid — nothing was executed.",
  PAYMENT_SCOPE: "The project moved to a different business — nothing was executed.",
};

/* ─── create_client_payment — confirm entry point ─────────────── */
export async function confirmCreateClientPayment(
  input: { confirmationId: string; token: string },
  principal: McpPrincipal,
): Promise<ConfirmOutcome<CreateClientPaymentResult>> {
  return runConfirmedAction({
    principal,
    confirmTool: "confirm_create_client_payment",
    actionTool: "create_client_payment",
    confirmationId: input.confirmationId,
    token: input.token,
    execution: makeCreateClientPaymentExecution(principal),
  });
}
