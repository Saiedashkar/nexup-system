-- ═══════════════════════════════════════════════════════════════
-- ADDITIVE MIGRATION — CapitalSpend type classification + recipient
--
-- No existing column is dropped or modified. No existing row is
-- changed in value: every historical CapitalSpend (including the
-- 74,260 EGP opening settlement) receives spendType = 'EXPENSE',
-- which is exactly its current meaning, so all totals and the
-- Available Capital balance behave identically before and after.
--
-- New:
--   CapitalSpendType enum            EXPENSE | PERSON_WITHDRAWAL | CUSTODY
--   CapitalSpend.spendType           classification (default EXPENSE)
--   CapitalSpend.recipientPartnerId  optional Partner link for per-person
--                                    capital-withdrawal reporting
--   CapitalSpend.recipientName       readable name snapshot at entry time
--
-- PERSON_WITHDRAWAL rows are CapitalSpend movements only — creating,
-- editing or deleting them never touches ProfitTransfer,
-- PartnerTransaction, revenue, treasury or any office expense table.
-- ═══════════════════════════════════════════════════════════════

-- 1) Enum type for spend classification
CREATE TYPE "CapitalSpendType" AS ENUM ('EXPENSE', 'PERSON_WITHDRAWAL', 'CUSTODY');

-- 2) CapitalSpend: classification + recipient (nullable / defaulted —
--    safe defaults for all historical rows)
ALTER TABLE "CapitalSpend" ADD COLUMN "spendType" "CapitalSpendType" NOT NULL DEFAULT 'EXPENSE';
ALTER TABLE "CapitalSpend" ADD COLUMN "recipientPartnerId" TEXT;
ALTER TABLE "CapitalSpend" ADD COLUMN "recipientName" TEXT;

-- 3) Indexes for classification filtering and per-person reporting
CREATE INDEX "CapitalSpend_spendType_idx" ON "CapitalSpend"("spendType");
CREATE INDEX "CapitalSpend_recipientPartnerId_idx" ON "CapitalSpend"("recipientPartnerId");

-- 4) Foreign key (SetNull: removing a Partner never destroys money rows).
--    Reporting link only — no cascade into profit accounting.
ALTER TABLE "CapitalSpend" ADD CONSTRAINT "CapitalSpend_recipientPartnerId_fkey"
  FOREIGN KEY ("recipientPartnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
