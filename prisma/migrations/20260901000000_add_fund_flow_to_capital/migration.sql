-- CreateEnum
CREATE TYPE "FundFlow" AS ENUM ('SPENT_ALREADY', 'STILL_IN_TREASURY');

-- AlterTable: Add fundFlow column (default SPENT_ALREADY for all existing records)
ALTER TABLE "CapitalContribution" ADD COLUMN "fundFlow" "FundFlow" NOT NULL DEFAULT 'SPENT_ALREADY';

-- AlterTable: Add linkedExpenseId column
ALTER TABLE "CapitalContribution" ADD COLUMN "linkedExpenseId" TEXT;

-- CreateIndex
CREATE INDEX "CapitalContribution_fundFlow_idx" ON "CapitalContribution"("fundFlow");
