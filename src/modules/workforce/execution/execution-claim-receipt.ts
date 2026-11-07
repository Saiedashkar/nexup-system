import type { JsonObject } from "@/modules/ai-workforce/core/types";

/**
 * The DISPATCH PREFLIGHT RECEIPT — the durable, non-secret evidence that a
 * dispatch was authorised, written ONCE, at the `DISPATCHING` boundary.
 *
 * WHY IT IS NOT A NEW TABLE. The claim ledger already has a bounded `detail`
 * column, and the receipt is bounded, canonical and non-secret: stable
 * identifiers, versions and decision codes — no credential, no cookie, no
 * provider token, no prompt, no payload. Reusing the column keeps the audit
 * evidence in the SAME row as the claim it justifies, which is the only row a
 * reconciler reads, so the evidence cannot be orphaned from the ledger entry it
 * belongs to.
 *
 * ── WRITE-ONCE, WITH NO SCHEMA CHANGE ──
 *
 * The rule is: once the receipt is committed at the `DISPATCHING` transition,
 * every later `detail` write must preserve it BYTE FOR BYTE. That is achieved
 * without touching the schema by storing the receipt as an ALREADY-SERIALISED
 * STRING inside a small JSON envelope:
 *
 *   {"receipt":"<the receipt, exactly as it was first serialised>","doubt":"..."}
 *
 * Later transitions (an `UNVERIFIED` promotion recording WHY) replace only
 * `doubt`; the `receipt` string is copied through untouched, so re-serialising
 * the envelope cannot reorder, reformat or re-encode the evidence. A plain
 * (non-JSON) `detail` written by an older row is still readable and is returned
 * as the human-readable text, so this is backward compatible in both directions.
 *
 * The whole point of the separate `doubt` key is honesty: `UNVERIFIED` after a
 * timeout keeps the receipt that proves dispatch WAS authorised, and adds the
 * doubt that says the outcome was not learned. Neither overwrites the other.
 */

/** Runtime identity of the process that dispatched. Bounded; never a credential. */
export type DispatchReceiptExecutor = {
  /** The invocation/lease token that owned the claim at the `DISPATCHING` boundary. */
  invocationToken: string;
  /** Non-secret process/instance label, for "which instance did this". */
  processId: string;
};

/** The governance evidence recorded when a dispatch is authorised. */
export type DispatchPreflightReceipt = {
  /** Envelope version, so a later reader can evolve the shape deliberately. */
  v: 1;
  /** The execution attempt this authorises. */
  missionId: string;
  taskId: string;
  attempt: number;
  idempotencyKey: string;
  /** Authenticated caller identity (ids only — never the rights, never a token). */
  requestedBy: string;
  operatorActorId: string;
  correlationId: string;
  /** What would execute, and how. */
  binding: string;
  actorId: string;
  capabilityId: string;
  capabilityVersion: string | null;
  assignmentId: string | null;
  runtimeId: string | null;
  /** The business scope, by registry slug (never a payload string). */
  businessSlug: string | null;
  /** The policy outcomes, as stable codes. */
  permission: { allowed: boolean; reason: string };
  approval: { required: boolean; satisfied: boolean; reason: string; approvalId: string | null };
  budget: { allowed: boolean; reason: string; policyRef: string; spend: string };
  risk: { level: string; decision: string };
  /** The single preflight verdict this receipt stands for. */
  decision: string;
  /** When the authorisation was taken (ISO-8601, server clock). */
  authorizedAt: string;
};

/** Keys whose presence would make a receipt unsafe to persist. */
const FORBIDDEN_RECEIPT_KEYS = [
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
  "jwt",
  "bearer",
  "apikey",
  "apiKey",
  "credential",
  "permissionTokens",
  "accessibleBusinessSlugs",
];

/**
 * Refuses a receipt that carries anything credential-shaped.
 *
 * It walks VALUES as well as keys, so a smuggled `{"a":"Bearer ey..."}` is
 * caught too. This is the same posture `assertNoCredentials` takes for an actor
 * or an authority; the receipt is written to a database, so it gets the same
 * guard rather than an assumption.
 */
export function assertReceiptIsSafe(receipt: unknown, label = "Dispatch preflight receipt"): void {
  const seen = new Set<unknown>();
  const walk = (value: unknown, path: string): void => {
    if (value === null || typeof value !== "object") {
      if (typeof value === "string" && /(bearer\s|-----BEGIN|eyJ[A-Za-z0-9_-]{10,})/i.test(value)) {
        throw new Error(`${label} carries a credential-shaped value at "${path}"`);
      }
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_RECEIPT_KEYS.includes(key)) {
        throw new Error(`${label} carries a forbidden key "${key}" at "${path}"`);
      }
      walk(nested, path ? `${path}.${key}` : key);
    }
  };
  walk(receipt, "");
}

/** The JSON envelope the `detail` column holds. */
export type ClaimDetailEnvelope = {
  /** The receipt, exactly as serialised when first written. */
  receipt?: string;
  /** A bounded, non-secret note about the CURRENT state (a doubt, a refusal). */
  doubt?: string;
};

/**
 * Encodes a `detail` value. The receipt is passed as a STRING (already
 * serialised) so this function can never alter it.
 */
export function encodeClaimDetail(envelope: ClaimDetailEnvelope): string {
  const out: Record<string, string> = {};
  if (envelope.receipt !== undefined) out.receipt = envelope.receipt;
  if (envelope.doubt !== undefined) out.doubt = envelope.doubt;
  return JSON.stringify(out);
}

/** The decoded view of a `detail` value. Never throws; legacy strings are text. */
export type DecodedClaimDetail = {
  /** The receipt JSON exactly as stored, when one was ever written. */
  receipt?: string;
  /** The parsed receipt, when it parses. */
  receiptValue?: DispatchPreflightReceipt;
  /** A bounded note about the current state. */
  doubt?: string;
  /** The human-readable text: the doubt, or the legacy plain string. */
  text: string;
};

export function decodeClaimDetail(detail: string | null | undefined): DecodedClaimDetail {
  if (!detail) return { text: "" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    // A plain, pre-envelope detail. Kept readable rather than discarded.
    return { text: detail };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { text: detail };
  const envelope = parsed as Record<string, unknown>;
  const result: DecodedClaimDetail = { text: "" };
  if (typeof envelope.receipt === "string") {
    result.receipt = envelope.receipt;
    const value = safeParseReceipt(envelope.receipt);
    if (value) result.receiptValue = value;
    result.text = result.receipt;
  }
  if (typeof envelope.doubt === "string") {
    result.doubt = envelope.doubt;
    result.text = envelope.doubt;
  }
  if (!result.text) result.text = detail;
  return result;
}

/** Serialises a receipt canonically. Never pretty-printed: bytes must be stable. */
export function serializeReceipt(receipt: DispatchPreflightReceipt): string {
  assertReceiptIsSafe(receipt);
  return JSON.stringify(receipt);
}

/**
 * The `detail` value a claim must carry at the `DISPATCHING` boundary.
 *
 * THIS IS THE ONLY CORRECT WAY TO SUPPLY A RECEIPT TO `markDispatching`. The
 * receipt is wrapped in the envelope (as an already-serialised STRING) because
 * every LATER transition reads the detail through `decodeClaimDetail` to decide
 * whether a receipt is present: a BARE receipt looks like a legacy plain detail,
 * so `detailWithDoubt` would see "no receipt" and drop it. That failure was
 * found by the Step 5A-4 receipt-preservation test — a receipt written without
 * this helper silently fails the write-once invariant, which is exactly the kind
 * of audit weakening the invariant exists to prevent.
 */
export function encodeReceiptDetail(receipt: DispatchPreflightReceipt): string {
  return encodeClaimDetail({ receipt: serializeReceipt(receipt) });
}

/**
 * Refuses a `receiptDetail` that does not actually carry a readable receipt.
 *
 * Fail closed rather than write a detail that silently loses the evidence: a
 * caller that passed a bare receipt is a BUG, and discovering it at the boundary
 * is the only way to keep the invariant honest.
 */
export function assertReceiptDetail(receiptDetail: string): void {
  if (!receiptFromClaimDetail(receiptDetail)) {
    throw new Error(
      "A dispatch preflight receipt must be supplied as the envelope produced by `encodeReceiptDetail`; " +
        "a bare receipt cannot be preserved through a later transition",
    );
  }
}

/**
 * Adds a doubt note to an existing detail WITHOUT touching a receipt that is
 * already there. This is the helper every later transition uses, so the
 * write-once invariant is enforced by construction rather than by remembering.
 */
export function detailWithDoubt(
  existingDetail: string | null | undefined,
  doubt: string,
): string {
  const decoded = decodeClaimDetail(existingDetail);
  return encodeClaimDetail({
    ...(decoded.receipt ? { receipt: decoded.receipt } : {}),
    doubt,
  });
}

/** The receipt a claim's detail carries, if any. */
export function receiptFromClaimDetail(detail: string | null | undefined): DispatchPreflightReceipt | undefined {
  return decodeClaimDetail(detail).receiptValue;
}

/** True when the detail carries a receipt and the later note did not replace it. */
export function detailPreservesReceipt(
  detail: string | null | undefined,
  expected: DispatchPreflightReceipt,
): boolean {
  return decodeClaimDetail(detail).receipt === serializeReceipt(expected);
}

function safeParseReceipt(json: string): DispatchPreflightReceipt | undefined {
  try {
    const value = JSON.parse(json) as DispatchPreflightReceipt;
    if (value && typeof value === "object" && value.v === 1) return value;
    return undefined;
  } catch {
    return undefined;
  }
}

/** A bounded summary for an operator surface (never the whole receipt). */
export function summarizeReceipt(receipt: DispatchPreflightReceipt): JsonObject {
  return {
    v: receipt.v,
    binding: receipt.binding,
    capabilityId: receipt.capabilityId,
    capabilityVersion: receipt.capabilityVersion,
    decision: receipt.decision,
    budgetReason: receipt.budget.reason,
    approvalReason: receipt.approval.reason,
    authorizedAt: receipt.authorizedAt,
  };
}
