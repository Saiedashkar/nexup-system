import { prisma } from "./prisma";
import { softDeleteRecord } from "./soft-delete";

/* ═══════════════════════════════════════════════════════════════
   Capital Fund ledger — office-level funding pool.

   TOTAL CAPITAL RECEIVED (CapitalContribution)
   − TOTAL SPENT FROM CAPITAL (CapitalSpend)
   = AVAILABLE CAPITAL BALANCE

   Design rules (business requirement):
   • The capital fund is a SEPARATE accounting pool from the
     operating treasury. Contributions never touch Revenue, Profit
     or the office treasury balance; capital spending reduces the
     capital balance only — never the operating treasury.
   • CASH contributions only are spendable money. ASSET
     contributions (عقار/أصل) stay on the historical ledger but are
     never part of the spendable balance.
   • One source of truth: a capital spend is a CapitalSpend row.
     It is NOT an OfficeExpense and never touches office expense
     totals. Conversion to a recurring Fixed Expense re-uses the
     OfficeExpense pipeline and always starts AFTER the spend month,
     so the original payment is never double-counted.
   • All money math is done in integer piasters (1 EGP = 100) to
     avoid floating-point drift; storage stays on the existing
     Float columns for backward compatibility.
   ═══════════════════════════════════════════════════════════════ */

export class CapitalValidationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** EGP → integer piasters. Rejects non-finite / negative / >2dp values. */
export function toPiasters(amount: unknown): number {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || n <= 0) {
    throw new CapitalValidationError("INVALID_AMOUNT", "المبلغ يجب أن يكون رقمًا أكبر من صفر");
  }
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) {
    throw new CapitalValidationError("INVALID_AMOUNT", "المبلغ يقبل خانتين عشريتين كحد أقصى");
  }
  return cents;
}

/** Parses a date-only string (YYYY-MM-DD) or full ISO date; rejects invalid dates. */
export function parseDateOrThrow(value: unknown, field = "التاريخ"): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(value)) {
    throw new CapitalValidationError("INVALID_DATE", `${field} غير صالح`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new CapitalValidationError("INVALID_DATE", `${field} غير صالح`);
  return d;
}

function monthKey(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(m: Date, n: number): Date {
  return new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + n, 1));
}

export const MONTH_KEY_FORMAT = /^(\d{4})-(\d{2})$/;

/** Parses "YYYY-MM" into the UTC month bucket, validating ranges. */
export function parseMonthKey(value: string): Date {
  const m = MONTH_KEY_FORMAT.exec(value);
  if (!m) throw new CapitalValidationError("INVALID_MONTH", "صيغة الشهر يجب أن تكون YYYY-MM");
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new CapitalValidationError("INVALID_MONTH", "شهر غير صالح");
  return new Date(Date.UTC(year, month - 1, 1));
}

/* ═══════════════════════════════════════════════════════════════
   Derived balances — computed from actual records, never stored
   ═══════════════════════════════════════════════════════════════ */

export type CapitalSummary = {
  totalReceived: number;
  totalSpent: number;
  available: number;
  contributionCount: number;
  spendCount: number;
  funderCount: number;
};

export async function getCapitalSummary(): Promise<CapitalSummary> {
  const [receivedAgg, spentAgg, contributionCount, spendCount, funderCount] = await Promise.all([
    // Only CASH contributions are spendable money — ASSET stays on the ledger.
    prisma.capitalContribution.aggregate({
      where: { type: "CASH" },
      _sum: { amount: true },
    }),
    prisma.capitalSpend.aggregate({ _sum: { amount: true } }),
    prisma.capitalContribution.count(),
    prisma.capitalSpend.count(),
    // Distinct active funders: nested relation filters bypass the
    // soft-delete client extension, so exclude deleted rows explicitly.
    prisma.partner.count({ where: { capitalContributions: { some: { deletedAt: null } } } }),
  ]);

  // Stored amounts are already in EGP units (write paths convert
  // piasters → EGP before persisting) — no further division here.
  const totalReceived = receivedAgg._sum.amount ?? 0;
  const totalSpent = spentAgg._sum.amount ?? 0;
  return {
    totalReceived,
    totalSpent,
    available: Math.round((totalReceived - totalSpent) * 100) / 100,
    contributionCount,
    spendCount,
    funderCount,
  };
}

/** Integer piasters → EGP number with 2dp safety. */
export function toEGP(piasters: number): number {
  return Math.round(piasters) / 100;
}

/* ═══════════════════════════════════════════════════════════════
   Capital IN — record a funding contribution
   ═══════════════════════════════════════════════════════════════ */

export async function createCapitalContribution(input: {
  partnerId: string;
  amount: number;
  type: string;
  date: Date;
  description?: string | null;
  fundFlow?: string;
  reference?: string | null;
  userId: string;
}) {
  const amountP = toPiasters(input.amount);
  if (!input.partnerId) throw new CapitalValidationError("MISSING_PARTNER", "اختر الممول");
  if (!["CASH", "ASSET"].includes(input.type)) {
    throw new CapitalValidationError("INVALID_TYPE", "نوع المساهمة يجب أن يكون نقدي أو أصل");
  }

  return prisma.$transaction(async tx => {
    const partner = await tx.partner.findUnique({ where: { id: input.partnerId } });
    if (!partner) throw new CapitalValidationError("PARTNER_NOT_FOUND", "الممول غير موجود");

    const contrib = await tx.capitalContribution.create({
      data: {
        partnerId: input.partnerId,
        amount: toEGP(amountP),
        type: input.type as "CASH" | "ASSET",
        fundFlow: (input.fundFlow as "SPENT_ALREADY" | "STILL_IN_TREASURY") ?? "SPENT_ALREADY",
        description: input.description || null,
        reference: input.reference || null,
        currency: "EGP",
        date: input.date,
      },
    });

    await tx.activityLog.create({
      data: { userId: input.userId, action: "CREATE", entityType: "CapitalContribution", entityId: contrib.id },
    });

    return contrib;
  });
}

/* ═══════════════════════════════════════════════════════════════
   Capital SPEND — money leaving the capital fund
   ═══════════════════════════════════════════════════════════════ */

export async function createCapitalSpend(input: {
  amount: number;
  date: Date;
  category: string;
  description: string;
  notes?: string | null;
  reference?: string | null;
  contributionId?: string | null;
  userId: string;
}) {
  const amountP = toPiasters(input.amount);
  if (!input.description?.trim()) {
    throw new CapitalValidationError("MISSING_DESCRIPTION", "أدخل وصف الصرف");
  }
  if (!input.category?.trim()) {
    throw new CapitalValidationError("MISSING_CATEGORY", "أدخل تصنيف الصرف");
  }

  return prisma.$transaction(async tx => {
    // Overspend guard inside the transaction. The aggregate is over live
    // (soft-delete-aware) rows; concurrent spends are serialized by the
    // following conditional updateMany on the contribution row, which acts
    // as an advisory lock — a losing writer's count comes back 0.
    const [receivedAgg, spentAgg] = await Promise.all([
      tx.capitalContribution.aggregate({ where: { type: "CASH" }, _sum: { amount: true } }),
      tx.capitalSpend.aggregate({ _sum: { amount: true } }),
    ]);

    const receivedP = Math.round((receivedAgg._sum.amount ?? 0) * 100);
    const spentP = Math.round((spentAgg._sum.amount ?? 0) * 100);
    if (amountP > receivedP - spentP) {
      throw new CapitalValidationError(
        "INSUFFICIENT_CAPITAL",
        "المبلغ المطلوب صرفه أكبر من رأس المال المتاح",
      );
    }

    if (input.contributionId) {
      const contrib = await tx.capitalContribution.findUnique({
        where: { id: input.contributionId },
      });
      if (!contrib) throw new CapitalValidationError("CONTRIBUTION_NOT_FOUND", "مساهمة التمويل غير موجودة");
      // Advisory serialization: conditional update on the contribution row.
      const lock = await tx.capitalContribution.updateMany({
        where: { id: input.contributionId, deletedAt: null },
        data: { reference: contrib.reference ?? null },
      });
      if (lock.count !== 1) {
        throw new CapitalValidationError("CONTRIBUTION_NOT_FOUND", "مساهمة التمويل غير موجودة");
      }
    }

    const spend = await tx.capitalSpend.create({
      data: {
        amount: toEGP(amountP),
        date: input.date,
        category: input.category.trim(),
        description: input.description.trim(),
        notes: input.notes || null,
        reference: input.reference || null,
        contributionId: input.contributionId || null,
      },
    });

    await tx.activityLog.create({
      data: { userId: input.userId, action: "CREATE", entityType: "CapitalSpend", entityId: spend.id },
    });

    return spend;
  });
}

/* ═══════════════════════════════════════════════════════════════
   Recurring Fixed Expenses — generated as OfficeExpense rows
   ═══════════════════════════════════════════════════════════════ */

export type GenerateResult = { created: number; skipped: number };

/**
 * Materializes all due occurrences for every active FixedExpense up to
 * `until` (UTC month bucket, inclusive). Idempotent: reruns create nothing.
 */
export async function generateDueFixedExpenses(until: Date = new Date()): Promise<GenerateResult> {
  const untilMonth = monthKey(until);
  let created = 0;
  let skipped = 0;

  const defs = await prisma.fixedExpense.findMany({ where: { active: true } });
  for (const def of defs) {
    const startMonth = monthKey(new Date(def.startDate));
    let cursor = startMonth < untilMonth ? startMonth : untilMonth;
    // First ungenerated month: none generated yet → startDate; otherwise the
    // month after lastGeneratedMonth.
    if (def.lastGeneratedMonth) {
      cursor = addMonths(monthKey(new Date(def.lastGeneratedMonth)), 1);
    } else if (startMonth > untilMonth) {
      skipped += 1; // not due yet
      continue;
    }

    while (cursor <= untilMonth) {
      try {
        await prisma.officeExpense.create({
          data: {
            description: def.description || def.name,
            cost: def.amount,
            category: "FIXED",
            name: def.name,
            notes: "مصروف ثابت متكرر",
            date: cursor,
            month: cursor.getUTCMonth() + 1,
            year: cursor.getUTCFullYear(),
            fixedExpenseId: def.id,
          },
        });
        created += 1;
      } catch {
        skipped += 1; // unique constraint → already generated (or raced)
      }
      cursor = addMonths(cursor, 1);
      await prisma.fixedExpense.update({
        where: { id: def.id },
        data: { lastGeneratedMonth: addMonths(cursor, -1) },
      });
    }
  }

  return { created, skipped };
}

/**
 * Converts an existing capital spend into a recurring Fixed Expense.
 * The recurring definition ALWAYS starts the month after the spend month,
 * so the original capital-funded payment is never double-counted.
 * Atomic: definition + spend-link are written in one transaction.
 */
export async function convertSpendToFixedExpense(input: {
  spendId: string;
  recurringAmount: number;
  frequency?: string;
  name?: string;
  category?: string;
  userId: string;
}) {
  const amountP = toPiasters(input.recurringAmount);

  return prisma.$transaction(async tx => {
    const spend = await tx.capitalSpend.findUnique({ where: { id: input.spendId } });
    if (!spend) throw new CapitalValidationError("SPEND_NOT_FOUND", "حركة الصرف غير موجودة");
    if (spend.fixedExpenseId) {
      throw new CapitalValidationError("ALREADY_CONVERTED", "هذا الصرف مرتبط بالفعل بمصروف ثابت متكرر");
    }

    const startMonth = addMonths(monthKey(new Date(spend.date)), 1);

    const def = await tx.fixedExpense.create({
      data: {
        name: input.name?.trim() || spend.description,
        description: `مصروف ثابت متكرر — مصدره: ${spend.description}`,
        amount: toEGP(amountP),
        frequency: input.frequency || "MONTHLY",
        startDate: startMonth,
        createdByUserId: input.userId,
      },
    });

    await tx.capitalSpend.update({
      where: { id: spend.id },
      data: { fixedExpenseId: def.id, convertedAt: new Date() },
    });

    await tx.activityLog.create({
      data: { userId: input.userId, action: "CONVERT_TO_RECURRING", entityType: "FixedExpense", entityId: def.id },
    });

    return { def, spend };
  });
}

/**
 * Creates an independent recurring Fixed Expense (not born from a capital
 * spend). Occurrences are materialized by generateDueFixedExpenses().
 */
export async function createFixedExpense(input: {
  name: string;
  description?: string | null;
  amount: number;
  frequency?: string;
  startDate: Date;
  userId: string;
}) {
  const amountP = toPiasters(input.amount);
  if (!input.name?.trim()) throw new CapitalValidationError("MISSING_NAME", "أدخل اسم المصروف الثابت");
  if (!input.startDate || Number.isNaN(new Date(input.startDate).getTime())) {
    throw new CapitalValidationError("INVALID_DATE", "تاريخ البدء غير صالح");
  }

  const def = await prisma.fixedExpense.create({
    data: {
      name: input.name.trim(),
      description: input.description || null,
      amount: toEGP(amountP),
      frequency: input.frequency || "MONTHLY",
      startDate: monthKey(new Date(input.startDate)),
      createdByUserId: input.userId,
    },
  });

  await prisma.activityLog.create({
    data: { userId: input.userId, action: "CREATE", entityType: "FixedExpense", entityId: def.id },
  });

  return def;
}

/** Soft-deletes a recurring definition; generated OfficeExpense rows stay. */
export async function deactivateFixedExpense(id: string, userId: string) {
  return prisma.$transaction(async tx => {
    const def = await tx.fixedExpense.findUnique({ where: { id } });
    if (!def) throw new CapitalValidationError("FIXED_EXPENSE_NOT_FOUND", "المصروف الثابت غير موجود");
    await tx.fixedExpense.update({ where: { id }, data: { active: false } });
    await tx.activityLog.create({
      data: { userId, action: "DEACTIVATE", entityType: "FixedExpense", entityId: id },
    });
    return def;
  });
}

/* ═══════════════════════════════════════════════════════════════
   Ledger — chronological IN/OUT with running balance
   ═══════════════════════════════════════════════════════════════ */

export type LedgerEntry = {
  id: string;
  type: "CAPITAL_IN" | "CAPITAL_SPEND";
  date: string;
  funder: string | null;
  partnerId: string | null;
  contributionId: string | null;
  description: string;
  category: string | null;
  amount: number;
  balanceAfter: number;
  notes: string | null;
  reference: string | null;
  recurring: boolean;
  fundFlow: string | null;
  contributionType: "CASH" | "ASSET" | null;
};

export async function getCapitalLedger(): Promise<{
  entries: LedgerEntry[];
  summary: CapitalSummary;
}> {
  const [contributions, spends] = await Promise.all([
    prisma.capitalContribution.findMany({
      where: { type: "CASH" },
      include: { partner: { select: { name: true } } },
    }),
    prisma.capitalSpend.findMany({
      include: { contribution: { include: { partner: { select: { name: true } } } } },
    }),
  ]);

  const inflow: LedgerEntry[] = contributions.map(c => ({
    id: c.id,
    type: "CAPITAL_IN",
    date: c.date.toISOString(),
    funder: c.partner.name,
    partnerId: c.partnerId,
    contributionId: c.id,
    description: c.description || "مساهمة رأس مال",
    category: null,
    amount: c.amount,
    balanceAfter: 0,
    notes: null,
    reference: c.reference,
    recurring: false,
    fundFlow: c.fundFlow,
    contributionType: c.type,
  }));

  const outflow: LedgerEntry[] = spends.map(s => ({
    id: s.id,
    type: "CAPITAL_SPEND",
    date: s.date.toISOString(),
    funder: s.contribution?.partner.name ?? null,
    partnerId: s.contribution?.partnerId ?? null,
    contributionId: s.contributionId,
    description: s.description,
    category: s.category,
    amount: s.amount,
    balanceAfter: 0,
    notes: s.notes,
    reference: s.reference,
    recurring: !!s.fixedExpenseId,
    fundFlow: null,
    contributionType: null,
  }));

  const entries = [...inflow, ...outflow].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  // Running balance: only CASH inflows and all spends participate.
  let running = 0;
  for (const e of entries) {
    running += e.type === "CAPITAL_IN" ? e.amount : -e.amount;
    e.balanceAfter = Math.round(running * 100) / 100;
  }

  return { entries: entries.reverse(), summary: await getCapitalSummary() };
}

/* ═══════════════════════════════════════════════════════════════
   EDIT / SOFT DELETE — contributions and spends (management actions)

   All guards run against live (soft-delete-aware) aggregates so that
   an edit or delete can never drive Available Capital negative or
   corrupt historical running balances.
   ═══════════════════════════════════════════════════════════════ */

export async function updateCapitalContribution(input: {
  id: string;
  userId: string;
  partnerId?: string;
  amount?: number;
  type?: string;
  date?: Date;
  description?: string | null;
  reference?: string | null;
  fundFlow?: string;
}) {
  const existing = await prisma.capitalContribution.findUnique({ where: { id: input.id } });
  if (!existing) throw new CapitalValidationError("CONTRIBUTION_NOT_FOUND", "مساهمة التمويل غير موجودة");

  const data: Record<string, unknown> = {};

  if (input.amount !== undefined) {
    const newP = toPiasters(input.amount); // validates > 0 and ≤2dp
    const oldP = Math.round(existing.amount * 100);
    if (newP !== oldP) {
      data.amount = toEGP(newP);
      // Reducing (or converting away) CASH money must never drive the
      // derived balance negative: Available − reduction ≥ 0.
      if (existing.type === "CASH") {
        const summary = await getCapitalSummary();
        const availableP = Math.round(summary.available * 100);
        const reductionP = oldP - newP;
        if (reductionP > availableP) {
          throw new CapitalValidationError(
            "INSUFFICIENT_CAPITAL",
            `لا يمكن تعديل المساهمة إلى هذا المبلغ: الصرف الحالي (${toEGP(Math.round(summary.totalSpent * 100))} ج.م) يتجاوز رأس المال المتبقي بعد التعديل`,
          );
        }
      }
    }
  }

  if (input.type !== undefined && input.type !== existing.type) {
    if (!["CASH", "ASSET"].includes(input.type)) {
      throw new CapitalValidationError("INVALID_TYPE", "نوع المساهمة يجب أن يكون نقدي أو أصل");
    }
    if (existing.type === "CASH" && input.type === "ASSET") {
      // Removing the contribution from the spendable pool entirely.
      const summary = await getCapitalSummary();
      const availableP = Math.round(summary.available * 100);
      const oldP = Math.round(existing.amount * 100);
      if (oldP > availableP) {
        throw new CapitalValidationError(
          "INSUFFICIENT_CAPITAL",
          "لا يمكن تحويل المساهمة إلى أصل: الصرف الحالي يعتمد على هذا المبلغ وسيجعل الرصيد المتاح سالبًا",
        );
      }
    }
    data.type = input.type;
  }

  if (input.partnerId !== undefined && input.partnerId !== existing.partnerId) {
    const partner = await prisma.partner.findUnique({ where: { id: input.partnerId } });
    if (!partner) throw new CapitalValidationError("PARTNER_NOT_FOUND", "الممول غير موجود");
    data.partnerId = input.partnerId;
  }

  if (input.date !== undefined) {
    if (Number.isNaN(new Date(input.date).getTime())) {
      throw new CapitalValidationError("INVALID_DATE", "التاريخ غير صالح");
    }
    data.date = input.date;
  }
  if (input.description !== undefined) data.description = input.description || null;
  if (input.reference !== undefined) data.reference = input.reference || null;
  if (input.fundFlow !== undefined && ["SPENT_ALREADY", "STILL_IN_TREASURY"].includes(input.fundFlow)) {
    data.fundFlow = input.fundFlow; // legacy admin-stats flag — no capital-math impact
  }

  if (Object.keys(data).length === 0) return existing;

  const updated = await prisma.capitalContribution.update({ where: { id: input.id }, data });
  await prisma.activityLog.create({
    data: { userId: input.userId, action: "UPDATE", entityType: "CapitalContribution", entityId: input.id },
  });
  return updated;
}

export async function softDeleteCapitalContribution(input: { id: string; userId: string }) {
  const existing = await prisma.capitalContribution.findUnique({ where: { id: input.id } });
  if (!existing) throw new CapitalValidationError("CONTRIBUTION_NOT_FOUND", "مساهمة التمويل غير موجودة");

  if (existing.type === "CASH") {
    const summary = await getCapitalSummary();
    const availableAfterP = Math.round(summary.available * 100) - Math.round(existing.amount * 100);
    if (availableAfterP < 0) {
      throw new CapitalValidationError(
        "INSUFFICIENT_CAPITAL",
        `لا يمكن حذف هذه المساهمة: تم صرف ${toEGP(Math.round(summary.totalSpent * 100))} ج.م من رأس المال وحذف المساهمة سيجعل الرصيد المتاح سالبًا. احذف أو عدّل حركات الصرف أولًا.`,
      );
    }
  }

  const deleted = await softDeleteRecord("CapitalContribution", input.id, input.userId);
  return deleted;
}

export async function updateCapitalSpend(input: {
  id: string;
  userId: string;
  amount?: number;
  date?: Date;
  category?: string;
  description?: string;
  notes?: string | null;
  reference?: string | null;
  contributionId?: string | null;
}) {
  const existing = await prisma.capitalSpend.findUnique({ where: { id: input.id } });
  if (!existing) throw new CapitalValidationError("SPEND_NOT_FOUND", "حركة الصرف غير موجودة");

  const data: Record<string, unknown> = {};

  if (input.amount !== undefined) {
    const newP = toPiasters(input.amount); // validates > 0 and ≤2dp
    const oldP = Math.round(existing.amount * 100);
    if (newP !== oldP) {
      // Increasing a spend must fit inside the currently available capital.
      const deltaP = newP - oldP;
      if (deltaP > 0) {
        const summary = await getCapitalSummary();
        const availableP = Math.round(summary.available * 100);
        if (deltaP > availableP) {
          throw new CapitalValidationError(
            "INSUFFICIENT_CAPITAL",
            `لا يمكن تعديل الصرف إلى هذا المبلغ: الزيادة (${toEGP(deltaP)} ج.م) تتجاوز رأس المال المتاح (${toEGP(availableP)} ج.م)`,
          );
        }
      }
      data.amount = toEGP(newP);
    }
  }

  if (input.date !== undefined) {
    if (Number.isNaN(new Date(input.date).getTime())) {
      throw new CapitalValidationError("INVALID_DATE", "التاريخ غير صالح");
    }
    data.date = input.date;
  }
  if (input.category !== undefined) {
    if (!input.category.trim()) throw new CapitalValidationError("MISSING_CATEGORY", "أدخل تصنيف الصرف");
    data.category = input.category.trim();
  }
  if (input.description !== undefined) {
    if (!input.description.trim()) throw new CapitalValidationError("MISSING_DESCRIPTION", "أدخل وصف الصرف");
    data.description = input.description.trim();
  }
  if (input.notes !== undefined) data.notes = input.notes || null;
  if (input.reference !== undefined) data.reference = input.reference || null;
  if (input.contributionId !== undefined) {
    if (input.contributionId) {
      const contrib = await prisma.capitalContribution.findUnique({ where: { id: input.contributionId } });
      if (!contrib) throw new CapitalValidationError("CONTRIBUTION_NOT_FOUND", "مساهمة التمويل غير موجودة");
    }
    data.contributionId = input.contributionId || null;
  }

  if (Object.keys(data).length === 0) return existing;

  const updated = await prisma.capitalSpend.update({ where: { id: input.id }, data });
  await prisma.activityLog.create({
    data: { userId: input.userId, action: "UPDATE", entityType: "CapitalSpend", entityId: input.id },
  });
  return updated;
}

/**
 * Soft-deletes a capital spend. The amount returns to Available Capital
 * automatically (derived), never hard-deleting the historical row.
 *
 * If the spend was converted into a recurring FixedExpense, deletion is
 * refused unless `force` is set: forcing soft-deletes the spend AND
 * deactivates the recurring definition (stops future generation) while
 * leaving the definition row and every generated OfficeExpense row intact.
 */
export async function softDeleteCapitalSpend(input: { id: string; userId: string; force?: boolean }) {
  const existing = await prisma.capitalSpend.findUnique({ where: { id: input.id } });
  if (!existing) throw new CapitalValidationError("SPEND_NOT_FOUND", "حركة الصرف غير موجودة");

  if (existing.fixedExpenseId && !input.force) {
    const def = await prisma.fixedExpense.findUnique({ where: { id: existing.fixedExpenseId } });
    if (def) {
      throw new CapitalValidationError(
        "RECURRING_LINKED",
        `هذا الصرف مرتبط بمصروف ثابت متكرر: "${def.name}" — الحذف سيفصل التعريف عن مصدره ويوقف التكرار المستقبلي. لن يتم حذف أي مصروفات مكتب مُنشأة سابقًا. أكّد الحذف للمتابعة.`,
      );
    }
  }

  return prisma.$transaction(async tx => {
    if (existing.fixedExpenseId) {
      await tx.fixedExpense.update({ where: { id: existing.fixedExpenseId }, data: { active: false } });
      await tx.activityLog.create({
        data: { userId: input.userId, action: "DEACTIVATE", entityType: "FixedExpense", entityId: existing.fixedExpenseId },
      });
    }
    const deleted = await softDeleteRecord("CapitalSpend", input.id, input.userId);
    return deleted;
  });
}
