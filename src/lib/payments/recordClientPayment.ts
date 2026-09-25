import type { Prisma } from "@prisma/client";
import { prismaRaw } from "@/lib/prisma";

/* ═══════════════════════════════════════════════════════════════
   NEXUP — shared atomic client-payment primitive

   The single implementation of the core client-payment mutation,
   used by BOTH callers that move money into the pool:

   • POST /api/client-payments (web, human session)
   • MCP confirm_create_client_payment (Red action, via the
     pending-action confirm transaction — no MCP logic lives here)

   Why it exists: a deterministic reproduction proved the old
   read-then-blind-update flows lose payments. Web reading first and
   MCP committing second let the web route's unconditional
   projectRecord.update overwrite the MCP-committed balance (payment
   rows survived; the balance silently forgot the money). Both flows
   now commit through this primitive, whose balance update is a
   compare-and-swap on the exact state it just read — Postgres
   re-evaluates that predicate against the latest committed row under
   the row lock, so whichever writer loses aborts instead of
   overwriting, in BOTH directions.

   Web calls the retrying wrapper (fresh read per attempt, max 3);
   MCP executes one attempt inside its confirm transaction and fails
   closed on conflict per the PendingAction lifecycle. No caller ever
   writes balance values it computed from a stale read.
   ═══════════════════════════════════════════════════════════════ */

/** Thrown when the CAS predicate no longer matches at update time. */
export class PaymentConflictError extends Error {
  readonly code = "PAYMENT_CONFLICT";
  constructor(message = "The project balance changed during the payment — retry with fresh data.") {
    super(message);
    this.name = "PaymentConflictError";
  }
}

/** Thrown for terminal, never-retryable validation failures. */
export class PaymentValidationError extends Error {
  readonly code: "PAYMENT_NOT_FOUND" | "PAYMENT_OVERPAYMENT" | "PAYMENT_INVALID_AMOUNT" | "PAYMENT_SCOPE";
  constructor(
    code: "PAYMENT_NOT_FOUND" | "PAYMENT_OVERPAYMENT" | "PAYMENT_INVALID_AMOUNT" | "PAYMENT_SCOPE",
    message: string,
  ) {
    super(message);
    this.name = "PaymentValidationError";
    this.code = code;
  }
}

export type RecordClientPaymentInput = {
  projectRecordId: string;
  /** SAR amount — must be finite, > 0, ≤ remaining, at cent precision. */
  amount: number;
  date?: Date;
  note?: string | null;
  /** Human user id (web session) or null (MCP has no User FK). */
  createdByUserId?: string | null;
  /**
   * When set (web session), an ActivityLog row for the created payment
   * is written inside the SAME transaction as the financial mutation,
   * so payment and its audit cannot diverge. MCP leaves it unset —
   * the MCP audit row is its execution audit, never ActivityLog.
   */
  activityLogUserId?: string | null;
  /** When the caller already knows the business, it is enforced. */
  expectedBusinessId?: string;
};

export type RecordedPayment = {
  paymentId: string;
  amount: number;
  projectId: string;
  clientId: string;
  clientName: string;
  projectName: string;
  businessId: string;
  depositAfter: number;
  remainingAfter: number;
  paymentStatusAfter: "FULL" | "PARTIAL" | "UNPAID";
  clientTierAfter: "VIP" | "LOYAL" | "NORMAL" | "DELINQUENT";
  poolTransactionNote: string;
};

/** DB money shape → number (finite enforced — refuse NaN/±Infinity). */
function moneyToNumber(d: unknown): number {
  const n = Number(d);
  if (!Number.isFinite(n)) {
    throw new PaymentValidationError("PAYMENT_INVALID_AMOUNT", "Stored balance is not a finite number.");
  }
  return n;
}

/** Cent rounding exactly like the existing flows. */
function toCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Web API stores `note || null`. */
function toNoteOrNull(note: string | null | undefined): string | null {
  if (note === undefined || note === null) return null;
  const trimmed = note.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Execute ONE payment attempt against the supplied transaction client.
 * Every failure throws → the whole attempt (consume/mutation/audit at
 * the caller level) rolls back. Order matters: the CAS balance swap
 * happens BEFORE any ClientPayment/PoolTransaction row exists.
 */
export async function recordClientPaymentInTx(
  tx: Prisma.TransactionClient,
  input: RecordClientPaymentInput,
): Promise<RecordedPayment> {
  const amount = input.amount;

  // (4) Amount: finite, positive, cent precision (2 decimals max).
  //     Executed even though both callers validate at their boundary —
  //     this primitive is the financial last line of defence.
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new PaymentValidationError("PAYMENT_INVALID_AMOUNT", "Amount must be a finite, positive number.");
  }
  if (Math.round(amount * 100) !== amount * 100) {
    throw new PaymentValidationError("PAYMENT_INVALID_AMOUNT", "Amount can have at most 2 decimal places.");
  }

  // (1) Live project + client. Uses the tx client (no soft-delete
  //     extension on transactions), so deletion is checked explicitly.
  const project = await tx.projectRecord.findUnique({
    where: { id: input.projectRecordId },
    include: { client: { select: { id: true, name: true, deletedAt: true } } },
  });
  // (2) Deleted/missing project or client is terminal — never retried.
  if (!project || project.deletedAt !== null) {
    throw new PaymentValidationError("PAYMENT_NOT_FOUND", "Project not found.");
  }
  if (!project.client || project.client.deletedAt !== null) {
    throw new PaymentValidationError("PAYMENT_NOT_FOUND", "The project's client no longer exists.");
  }

  // (3) Business scope, when the caller has one (MCP's pending row).
  if (input.expectedBusinessId && project.businessId !== input.expectedBusinessId) {
    throw new PaymentValidationError("PAYMENT_SCOPE", "The project does not belong to the expected business.");
  }

  const remaining = moneyToNumber(project.remaining);
  const deposit = moneyToNumber(project.deposit);
  const totalPrice = moneyToNumber(project.totalPrice);

  // (5) Overpayment is terminal validation, not a retryable conflict.
  if (amount > remaining) {
    throw new PaymentValidationError(
      "PAYMENT_OVERPAYMENT",
      `Amount exceeds remaining (${remaining.toFixed(2)}).`,
    );
  }

  // (6) New balance — cents-exact, mirroring the original flows.
  const newDeposit = toCents(deposit + amount);
  const newRemaining = toCents(Math.max(0, totalPrice - newDeposit));
  const newPaymentStatus: "FULL" | "PARTIAL" | "UNPAID" =
    newRemaining <= 0 ? "FULL" : newDeposit > 0 ? "PARTIAL" : "UNPAID";

  // (7) CAS — the heart of the fix. The predicate pins the exact state
  //     this attempt read. Postgres re-evaluates it on the latest
  //     committed version under the row lock: a concurrent payment that
  //     committed in between makes count = 0 and this attempt aborts.
  //     Decimal equality in SQL is exact numeric comparison.
  const swapped = await tx.projectRecord.updateMany({
    where: {
      id: project.id,
      deposit: project.deposit,
      remaining: project.remaining,
      totalPrice: project.totalPrice,
      clientId: project.clientId,
    },
    data: {
      deposit: newDeposit,
      remaining: newRemaining,
      paymentStatus: newPaymentStatus,
    },
  });
  // (8) count !== 1 → someone else moved first. Retryable by the web
  //     wrapper; terminal (fail-closed) for MCP.
  if (swapped.count !== 1) {
    throw new PaymentConflictError();
  }

  // (9) Exactly one payment row.
  const payment = await tx.clientPayment.create({
    data: {
      projectRecordId: project.id,
      amount,
      date: input.date ?? new Date(),
      note: toNoteOrNull(input.note),
      createdByUserId: input.createdByUserId ?? null,
    },
  });

  // (10) Exactly one matching pool IN — same project/business, exact SAR amount.
  const poolNote = `Payment: ${project.client.name} — ${project.projectName}${
    input.note ? ` (${input.note.trim()})` : ""
  }`;
  await tx.poolTransaction.create({
    data: {
      businessId: project.businessId,
      projectRecordId: project.id,
      amountSAR: amount,
      type: "IN",
      date: input.date ?? new Date(),
      note: poolNote,
    },
  });

  // (11) Tier recompute from aggregates over LIVE projects only
  //      (deletedAt: null — this tx client is raw). Thresholds are the
  //      application's current ones, never incremental.
  const projectCount = await tx.projectRecord.count({
    where: { clientId: project.clientId, deletedAt: null },
  });
  const totalPaidAgg = await tx.projectRecord.aggregate({
    where: { clientId: project.clientId, paymentStatus: "FULL", deletedAt: null },
    _sum: { totalPrice: true },
  });
  const totalRevenue = Number(totalPaidAgg._sum.totalPrice ?? 0);
  let tier: "VIP" | "LOYAL" | "NORMAL" | "DELINQUENT" = "NORMAL";
  if (totalRevenue > 1000 || projectCount >= 3) tier = "VIP";
  else if (totalRevenue > 500 || projectCount >= 2) tier = "LOYAL";
  await tx.client.update({ where: { id: project.clientId }, data: { tier } });

  // Optional web ActivityLog — same transaction, same fate.
  if (input.activityLogUserId) {
    await tx.activityLog.create({
      data: {
        userId: input.activityLogUserId,
        action: "CREATE",
        entityType: "ClientPayment",
        entityId: payment.id,
      },
    });
  }

  return {
    paymentId: payment.id,
    amount,
    projectId: project.id,
    clientId: project.clientId,
    clientName: project.client.name,
    projectName: project.projectName,
    businessId: project.businessId,
    depositAfter: newDeposit,
    remainingAfter: newRemaining,
    paymentStatusAfter: newPaymentStatus,
    clientTierAfter: tier,
    poolTransactionNote: poolNote,
  };
}

/**
 * Web entry point: run attempts in fresh transactions, retrying ONLY
 * the CAS conflict (a writer raced us). Validation, overpayment,
 * not-found, scope and arbitrary DB errors propagate immediately —
 * they are not fixed by re-reading. Max 3 attempts; exhaustion throws
 * PaymentConflictError so the route answers a safe conflict instead of
 * ever writing stale values.
 */
export async function recordClientPaymentWithRetry(
  input: RecordClientPaymentInput,
  opts?: { maxAttempts?: number },
): Promise<RecordedPayment> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  let lastConflict: PaymentConflictError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await prismaRaw.$transaction((tx) => recordClientPaymentInTx(tx, input));
    } catch (err) {
      if (err instanceof PaymentConflictError) {
        lastConflict = err;
        continue; // fresh read on the next attempt
      }
      throw err;
    }
  }
  throw lastConflict ?? new PaymentConflictError();
}
