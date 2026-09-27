-- ═══════════════════════════════════════════════════════════════
-- ADDITIVE MIGRATION — Capital Ledger + Recurring Fixed Expenses
--
-- No existing column is dropped or modified. No existing row is touched.
-- Existing CapitalContribution rows keep their meaning unchanged
-- (fundFlow defaults preserved; new columns are nullable / defaulted).
--
-- New model summary:
--   CapitalSpend      money spent FROM the capital fund (one office pool)
--   FixedExpense      recurring fixed-expense DEFINITION (first recurring engine)
--   OfficeExpense.fixedExpenseId   provenance link for generated rows
--   CapitalContribution.currency/reference         attribution metadata
-- ═══════════════════════════════════════════════════════════════

-- 1) CapitalContribution: funder attribution metadata
ALTER TABLE "CapitalContribution" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'EGP';
ALTER TABLE "CapitalContribution" ADD COLUMN "reference" TEXT;

-- 2) FixedExpense — recurring definition (occurrences materialize as OfficeExpense)
CREATE TABLE "FixedExpense" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "startDate" TIMESTAMP(3) NOT NULL,
    "lastGeneratedMonth" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "FixedExpense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FixedExpense_active_idx" ON "FixedExpense"("active");
CREATE INDEX "FixedExpense_deletedAt_idx" ON "FixedExpense"("deletedAt");

-- 3) CapitalSpend — spending from the capital fund
CREATE TABLE "CapitalSpend" (
    "id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "notes" TEXT,
    "reference" TEXT,
    "contributionId" TEXT,
    "fixedExpenseId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,

    CONSTRAINT "CapitalSpend_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CapitalSpend_date_idx" ON "CapitalSpend"("date");
CREATE INDEX "CapitalSpend_contributionId_idx" ON "CapitalSpend"("contributionId");
CREATE INDEX "CapitalSpend_deletedAt_idx" ON "CapitalSpend"("deletedAt");

-- 4) OfficeExpense: provenance link to the FixedExpense that generated it
ALTER TABLE "OfficeExpense" ADD COLUMN "fixedExpenseId" TEXT;
CREATE INDEX "OfficeExpense_fixedExpenseId_idx" ON "OfficeExpense"("fixedExpenseId");

-- Idempotency guard: a recurring definition can generate at most one
-- OfficeExpense per month. Partial index so soft-deleted occurrences
-- can be regenerated if a definition is corrected.
CREATE UNIQUE INDEX "OfficeExpense_fixedExpenseId_year_month_key"
  ON "OfficeExpense"("fixedExpenseId", "year", "month")
  WHERE "fixedExpenseId" IS NOT NULL AND "deletedAt" IS NULL;

-- 5) Foreign keys (SetNull everywhere: deleting the parent never destroys money rows)
ALTER TABLE "CapitalSpend" ADD CONSTRAINT "CapitalSpend_contributionId_fkey"
  FOREIGN KEY ("contributionId") REFERENCES "CapitalContribution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CapitalSpend" ADD CONSTRAINT "CapitalSpend_fixedExpenseId_fkey"
  FOREIGN KEY ("fixedExpenseId") REFERENCES "FixedExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OfficeExpense" ADD CONSTRAINT "OfficeExpense_fixedExpenseId_fkey"
  FOREIGN KEY ("fixedExpenseId") REFERENCES "FixedExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
