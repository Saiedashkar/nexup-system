-- ═══════════════════════════════════════════════════════════════════
-- SAFE / ADDITIVE MIGRATION ONLY
-- Adds two nullable columns (deletedAt, deletedByUserId) plus an index
-- on deletedAt to every table that holds deletable records.
--
-- No existing column is dropped or modified.
-- No existing row is touched: deletedAt stays NULL (= "not deleted")
-- for every record that exists today.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE "Client" ADD COLUMN     "deletedAt" TIMESTAMP(3),
                      ADD COLUMN     "deletedByUserId" TEXT;
CREATE INDEX "Client_deletedAt_idx" ON "Client"("deletedAt");

ALTER TABLE "ProjectRecord" ADD COLUMN     "deletedAt" TIMESTAMP(3),
                            ADD COLUMN     "deletedByUserId" TEXT;
CREATE INDEX "ProjectRecord_deletedAt_idx" ON "ProjectRecord"("deletedAt");

ALTER TABLE "PoolTransaction" ADD COLUMN     "deletedAt" TIMESTAMP(3),
                             ADD COLUMN     "deletedByUserId" TEXT;
CREATE INDEX "PoolTransaction_deletedAt_idx" ON "PoolTransaction"("deletedAt");

ALTER TABLE "Withdrawal" ADD COLUMN     "deletedAt" TIMESTAMP(3),
                         ADD COLUMN     "deletedByUserId" TEXT;
CREATE INDEX "Withdrawal_deletedAt_idx" ON "Withdrawal"("deletedAt");

ALTER TABLE "Expense" ADD COLUMN     "deletedAt" TIMESTAMP(3),
                      ADD COLUMN     "deletedByUserId" TEXT;
CREATE INDEX "Expense_deletedAt_idx" ON "Expense"("deletedAt");

ALTER TABLE "ClientPayment" ADD COLUMN     "deletedAt" TIMESTAMP(3),
                            ADD COLUMN     "deletedByUserId" TEXT;
CREATE INDEX "ClientPayment_deletedAt_idx" ON "ClientPayment"("deletedAt");

ALTER TABLE "PartnerTransaction" ADD COLUMN     "deletedAt" TIMESTAMP(3),
                                 ADD COLUMN     "deletedByUserId" TEXT;
CREATE INDEX "PartnerTransaction_deletedAt_idx" ON "PartnerTransaction"("deletedAt");

ALTER TABLE "OfficeExpense" ADD COLUMN     "deletedAt" TIMESTAMP(3),
                            ADD COLUMN     "deletedByUserId" TEXT;
CREATE INDEX "OfficeExpense_deletedAt_idx" ON "OfficeExpense"("deletedAt");

ALTER TABLE "CapitalContribution" ADD COLUMN     "deletedAt" TIMESTAMP(3),
                                  ADD COLUMN     "deletedByUserId" TEXT;
CREATE INDEX "CapitalContribution_deletedAt_idx" ON "CapitalContribution"("deletedAt");

ALTER TABLE "OfficeAllocationSetting" ADD COLUMN     "deletedAt" TIMESTAMP(3),
                                      ADD COLUMN     "deletedByUserId" TEXT;
CREATE INDEX "OfficeAllocationSetting_deletedAt_idx" ON "OfficeAllocationSetting"("deletedAt");

ALTER TABLE "ProfitTransfer" ADD COLUMN     "deletedAt" TIMESTAMP(3),
                             ADD COLUMN     "deletedByUserId" TEXT;
CREATE INDEX "ProfitTransfer_deletedAt_idx" ON "ProfitTransfer"("deletedAt");

ALTER TABLE "NexupProfitLedger" ADD COLUMN     "deletedAt" TIMESTAMP(3),
                                ADD COLUMN     "deletedByUserId" TEXT;
CREATE INDEX "NexupProfitLedger_deletedAt_idx" ON "NexupProfitLedger"("deletedAt");

ALTER TABLE "Property" ADD COLUMN     "deletedAt" TIMESTAMP(3),
                       ADD COLUMN     "deletedByUserId" TEXT;
CREATE INDEX "Property_deletedAt_idx" ON "Property"("deletedAt");

ALTER TABLE "Deal" ADD COLUMN     "deletedAt" TIMESTAMP(3),
                   ADD COLUMN     "deletedByUserId" TEXT;
CREATE INDEX "Deal_deletedAt_idx" ON "Deal"("deletedAt");

ALTER TABLE "Subscription" ADD COLUMN     "deletedAt" TIMESTAMP(3),
                           ADD COLUMN     "deletedByUserId" TEXT;
CREATE INDEX "Subscription_deletedAt_idx" ON "Subscription"("deletedAt");

ALTER TABLE "SubscriptionInvoice" ADD COLUMN     "deletedAt" TIMESTAMP(3),
                                  ADD COLUMN     "deletedByUserId" TEXT;
CREATE INDEX "SubscriptionInvoice_deletedAt_idx" ON "SubscriptionInvoice"("deletedAt");

ALTER TABLE "OfficeTool" ADD COLUMN     "deletedAt" TIMESTAMP(3),
                         ADD COLUMN     "deletedByUserId" TEXT;
CREATE INDEX "OfficeTool_deletedAt_idx" ON "OfficeTool"("deletedAt");

ALTER TABLE "OfficeToolPayment" ADD COLUMN     "deletedAt" TIMESTAMP(3),
                                ADD COLUMN     "deletedByUserId" TEXT;
CREATE INDEX "OfficeToolPayment_deletedAt_idx" ON "OfficeToolPayment"("deletedAt");
