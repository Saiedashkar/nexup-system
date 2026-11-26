import { prisma } from "./prisma";

/* ═══════════════════════════════════════════════════════════════
   Capital & Treasury metrics — ONE source of truth.

   Every screen (capital page, admin top bar, dashboard) and every API
   (admin-stats, stats, capital-ledger) reads its numbers from here, so a
   figure can never mean two different things in two places again.

   Definitions (all derived from records — nothing is stored, nothing is
   hardcoded):

   • cashFundingReceived   إجمالي التمويل النقدي المستلم
       Σ active CASH contributions. Spending NEVER reduces it (a capital
       total that shrinks when money is spent is how the old ledger lost
       track of what was actually received).
   • cashFundingInTreasury الجزء الذي دخل خزينة المكتب فعليًا
       Σ active CASH ∧ fundFlow = STILL_IN_TREASURY.
   • cashFundingSpentAlready الجزء الذي صُرف مباشرة من قِبل الممول
       Σ active CASH ∧ fundFlow = SPENT_ALREADY. It is money the office
       never received, so it can never increase available cash.
   • assetFunding          مساهمات عينية (ASSET)
       Shown on its own line. In-kind funding is NOT cash and never
       increases the available balance.
   • availableFund         رأس المال المتاح (الصندوق)
       cashFundingReceived − totalSpent. The fund's net remaining.
   • treasuryDrawSpend     مصروف مدفوع من النقد الفعلي في الخزينة
       A spend charged to the treasury only when its funding source really
       was treasury cash: a spend linked to a STILL_IN_TREASURY
       contribution, or an unlinked spend that the already-spent funding
       could not mirror. Every other spend is already represented by the
       SPENT_ALREADY funding that carries it — charging it to the treasury
       again is exactly the double count that produced the phantom balance.
   • cashInTreasuryNet     النقد في الخزينة من رأس المال
       cashFundingInTreasury − treasuryDrawSpend. May be negative: that is
       a real over-draw, reported (never clamped away silently).
   • availableCashInTreasury النقد المتاح فعليًا
       max(0, cashInTreasuryNet): a cash pool cannot hold a negative amount,
       and an over-draw is not swallowed — it is reported in full as
       unfundedFromTreasury. Funding flagged "already spent" is NEVER added
       here: by definition that money never entered the office.
   • unfundedFromTreasury  صرف يتجاوز تمويله النقدي (يحتاج مراجعة)
   • unmatchedAlreadySpentFunding تمويل «مصروف بالفعل» بلا صرف يقابله

   Capital is NOT revenue and NOT profit: nothing here touches
   ProfitTransfer, OfficeExpense, PartnerTransaction or client money.

   Currency: totals are summed per currency (EGP) and never mixed; a
   non-EGP row is excluded from the EGP totals and reported separately.
   ═══════════════════════════════════════════════════════════════ */

export const BASE_CURRENCY = "EGP";

export type CapitalContributionInput = {
  id: string;
  amount: number;
  type: "CASH" | "ASSET" | string;
  fundFlow: "SPENT_ALREADY" | "STILL_IN_TREASURY" | string;
  currency: string;
};

export type CapitalSpendInput = {
  id: string;
  amount: number;
  date: Date | string | number;
  contributionId: string | null;
};

export type CapitalMetrics = {
  currency: string;
  foreignCurrency: { currency: string; received: number; spent: number; rows: number }[];

  /** إجمالي التمويل النقدي المستلم (لا ينقص بالصرف) */
  cashFundingReceived: number;
  /** الجزء الذي دخل الخزينة فعليًا */
  cashFundingInTreasury: number;
  /** الجزء الذي صرفه الممول مباشرة */
  cashFundingSpentAlready: number;
  /** مساهمات عينية — تُعرض مستقلة ولا تزيد النقد */
  assetFunding: number;
  /** نقدي + عيني (سطر تعريفي فقط، لا يدخل أي رصيد) */
  totalFundingInclAssets: number;

  totalSpent: number;
  /** رأس المال المتاح = المستلم − المصروف */
  availableFund: number;

  /** مصروف محمّل على النقد الفعلي في الخزينة */
  treasuryDrawSpend: number;
  /** مصروف مقابله تمويل «مصروف بالفعل» (لا يمس النقد) */
  alreadySpentMirrorSpend: number;
  /** النقد في الخزينة من رأس المال (قد يكون سالبًا = سحب على المكشوف) */
  cashInTreasuryNet: number;
  /** النقد المتاح فعليًا بعد تسوية الفروق غير المحسومة */
  availableCashInTreasury: number;
  /** صرف تجاوز تمويله النقدي */
  unfundedFromTreasury: number;
  /** تمويل «مصروف بالفعل» لا يقابله أي صرف */
  unmatchedAlreadySpentFunding: number;
  /** فروق تحتاج مراجعة بشرية (نصوص عربية جاهزة للعرض) */
  reconciliationWarnings: string[];

  cashContributionCount: number;
  assetContributionCount: number;
  spendCount: number;
  funderCount: number;
};

export type OfficeTreasury = {
  /** رصيد الخزينة التشغيلي */
  balance: number;
  /** النقد المتاح من رأس المال (البند أعلاه) */
  capitalCash: number;
  profitTransfers: number;
  officeExpenses: number;
  partnerOutflows: number;
  partnerInflows: number;
  capital: CapitalMetrics;
};

const toP = (n: number) => Math.round((Number(n) || 0) * 100);
const toEGP = (p: number) => Math.round(p) / 100;

/**
 * Pure allocation core — no database, fully unit-testable.
 * Everything is computed in integer piasters so no float drift can leak
 * into a balance.
 */
export function computeCapitalMetrics(input: {
  contributions: CapitalContributionInput[];
  spends: CapitalSpendInput[];
  funderCount?: number;
}): CapitalMetrics {
  const egp = input.contributions.filter(c => (c.currency ?? BASE_CURRENCY) === BASE_CURRENCY);
  const foreignRows = input.contributions.filter(c => (c.currency ?? BASE_CURRENCY) !== BASE_CURRENCY);

  const cash = egp.filter(c => c.type === "CASH");
  const cashReceivedP = cash.reduce((s, c) => s + toP(c.amount), 0);
  const cashInTreasuryP = cash
    .filter(c => c.fundFlow === "STILL_IN_TREASURY")
    .reduce((s, c) => s + toP(c.amount), 0);
  const cashSpentAlreadyP = cashReceivedP - cashInTreasuryP;
  const assetP = egp.filter(c => c.type === "ASSET").reduce((s, c) => s + toP(c.amount), 0);
  const spentP = input.spends.reduce((s, x) => s + toP(x.amount), 0);

  const byId = new Map(egp.map(c => [c.id, c] as const));

  // Chronological allocation: each spend is charged to its funding source.
  const ordered = [...input.spends].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  let absorbedByAlreadyP = 0;
  let treasuryDrawP = 0;
  // Reserve explicit funding links BEFORE allocating unlinked expenses.
  // Otherwise an early unlinked settlement can consume the same direct
  // funding that a later explicitly linked expense consumes again.
  const unlinked: CapitalSpendInput[] = [];
  for (const spend of ordered) {
    const amtP = toP(spend.amount);
    const linked = spend.contributionId ? byId.get(spend.contributionId) : undefined;
    if (!linked) { unlinked.push(spend); continue; }
    if (linked.type === "CASH" && linked.fundFlow === "STILL_IN_TREASURY") treasuryDrawP += amtP;
    else absorbedByAlreadyP += amtP;
  }
  for (const spend of unlinked) {
    const amtP = toP(spend.amount);
    const room = Math.max(0, cashSpentAlreadyP - absorbedByAlreadyP);
    const absorbed = Math.min(amtP, room);
    absorbedByAlreadyP += absorbed;
    treasuryDrawP += amtP - absorbed;
  }

  const cashInTreasuryNetP = cashInTreasuryP - treasuryDrawP;
  const unfundedP = Math.max(0, treasuryDrawP - cashInTreasuryP);
  const unmatchedAlreadyP = Math.max(0, cashSpentAlreadyP - absorbedByAlreadyP);
  // Already-spent funding is money the office never held, so it can never
  // become available cash — not even to cover an over-draw. An over-draw is
  // reported through unfundedFromTreasury instead of being netted away here.
  const availableCashP = Math.max(0, cashInTreasuryNetP);

  const warnings: string[] = [];
  if (unfundedP > 0) {
    warnings.push(
      `مصروف محمّل على الخزينة يتجاوز التمويل النقدي بمقدار ${toEGP(unfundedP)} ${BASE_CURRENCY} — راجع ربط الصرف بالمساهمة أو سجّل الفرق كتمويل.`,
    );
  }
  if (unmatchedAlreadyP > 0) {
    warnings.push(
      `تمويل «مصروف بالفعل» بمقدار ${toEGP(unmatchedAlreadyP)} ${BASE_CURRENCY} لا يقابله أي حركة صرف — راجع نوع المساهمة.`,
    );
  }
  if (foreignRows.length > 0) {
    const codes = [...new Set(foreignRows.map(c => c.currency))].join("، ");
    warnings.push(
      `توجد ${foreignRows.length} مساهمة بعملة غير ${BASE_CURRENCY} (${codes}) مستبعدة من الإجماليات — لا تُجمع العملات دون تحويل.`,
    );
  }

  const funders = new Set(egp.filter(c => c.type === "CASH").map(c => (c as { partnerId?: string }).partnerId ?? c.id));

  return {
    currency: BASE_CURRENCY,
    foreignCurrency: foreignRows.map(c => ({
      currency: c.currency,
      received: c.amount,
      spent: 0,
      rows: 1,
    })),
    cashFundingReceived: toEGP(cashReceivedP),
    cashFundingInTreasury: toEGP(cashInTreasuryP),
    cashFundingSpentAlready: toEGP(cashSpentAlreadyP),
    assetFunding: toEGP(assetP),
    totalFundingInclAssets: toEGP(cashReceivedP + assetP),
    totalSpent: toEGP(spentP),
    availableFund: toEGP(cashReceivedP - spentP),
    treasuryDrawSpend: toEGP(treasuryDrawP),
    alreadySpentMirrorSpend: toEGP(absorbedByAlreadyP),
    cashInTreasuryNet: toEGP(cashInTreasuryNetP),
    availableCashInTreasury: toEGP(availableCashP),
    unfundedFromTreasury: toEGP(unfundedP),
    unmatchedAlreadySpentFunding: toEGP(unmatchedAlreadyP),
    reconciliationWarnings: warnings,
    cashContributionCount: cash.length,
    assetContributionCount: egp.length - cash.length,
    spendCount: input.spends.length,
    funderCount: input.funderCount ?? funders.size,
  };
}

/** Reads live (soft-delete aware) capital records and computes the metrics. */
export async function getCapitalMetrics(): Promise<CapitalMetrics> {
  const [contributions, spends, funderCount] = await Promise.all([
    prisma.capitalContribution.findMany({
      select: { id: true, amount: true, type: true, fundFlow: true, currency: true, partnerId: true },
    }),
    prisma.capitalSpend.findMany({ select: { id: true, amount: true, date: true, contributionId: true } }),
    // Distinct active funders: nested relation filters bypass the soft-delete
    // extension, so deleted rows are excluded explicitly.
    prisma.partner.count({ where: { capitalContributions: { some: { deletedAt: null, type: "CASH" } } } }),
  ]);

  return computeCapitalMetrics({
    contributions: contributions.map(c => ({
      id: c.id,
      amount: c.amount,
      type: c.type,
      fundFlow: c.fundFlow,
      currency: c.currency,
      partnerId: c.partnerId,
    })),
    spends,
    funderCount,
  });
}

/**
 * The operating treasury: capital cash that really sits in the office,
 * plus office income, minus office spending and partner outflows.
 * Capital contributions never became revenue and never will — the terms
 * stay separate on purpose.
 */
export async function getOfficeTreasury(): Promise<OfficeTreasury> {
  const [capital, profitTransfers, officeExpenses, partnerTx] = await Promise.all([
    getCapitalMetrics(),
    prisma.profitTransfer.findMany({ select: { amount: true } }),
    prisma.officeExpense.findMany({ select: { cost: true } }),
    prisma.partnerTransaction.findMany({ select: { type: true, amount: true } }),
  ]);

  const totalProfitTransfers = profitTransfers.reduce((s, t) => s + t.amount, 0);
  const totalOfficeExpenses = officeExpenses.reduce((s, e) => s + e.cost, 0);
  const partnerOutflows = partnerTx
    .filter(t => ["SALARY", "ADVANCE", "WITHDRAWAL", "PROFIT_SHARE"].includes(t.type))
    .reduce((s, t) => s + t.amount, 0);
  const partnerInflows = partnerTx
    .filter(t => t.type === "LOAN_SETTLEMENT")
    .reduce((s, t) => s + t.amount, 0);

  return {
    balance:
      Math.round(
        (capital.availableCashInTreasury + totalProfitTransfers - totalOfficeExpenses - partnerOutflows + partnerInflows) *
          100,
      ) / 100,
    capitalCash: capital.availableCashInTreasury,
    profitTransfers: totalProfitTransfers,
    officeExpenses: totalOfficeExpenses,
    partnerOutflows,
    partnerInflows,
    capital,
  };
}
