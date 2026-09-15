/**
 * Models that carry the soft-delete columns (`deletedAt`, `deletedByUserId`).
 *
 * Anything read from these models is automatically filtered with
 * `deletedAt: null` by the Prisma client extension in `src/lib/prisma.ts`,
 * so balances / totals / counts never include a deleted record.
 *
 * Keep this list in sync with `prisma/schema.prisma`.
 */
export const SOFT_DELETE_MODELS = [
  "Client",
  "ProjectRecord",
  "PoolTransaction",
  "Withdrawal",
  "Expense",
  "ClientPayment",
  "PartnerTransaction",
  "OfficeExpense",
  "CapitalContribution",
  "OfficeAllocationSetting",
  "ProfitTransfer",
  "NexupProfitLedger",
  "Property",
  "Deal",
  "Subscription",
  "SubscriptionInvoice",
  "OfficeTool",
  "OfficeToolPayment",
] as const;

export type SoftDeleteModel = (typeof SOFT_DELETE_MODELS)[number];

export const SOFT_DELETE_MODEL_SET: ReadonlySet<string> = new Set<string>(SOFT_DELETE_MODELS);

export function isSoftDeleteModel(model: string): model is SoftDeleteModel {
  return SOFT_DELETE_MODEL_SET.has(model);
}
