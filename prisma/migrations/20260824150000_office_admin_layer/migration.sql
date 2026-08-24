-- CreateEnum
CREATE TYPE "PartnerTransactionType" AS ENUM ('SALARY', 'PROFIT_SHARE', 'ADVANCE', 'WITHDRAWAL', 'LOAN_SETTLEMENT');

-- CreateEnum
CREATE TYPE "CapitalType" AS ENUM ('CASH', 'ASSET');

-- CreateEnum
CREATE TYPE "ExpenseCat" AS ENUM ('FIXED', 'VARIABLE');

-- CreateTable: Partner
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable: BusinessOwnership
CREATE TABLE "BusinessOwnership" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "ownershipPct" DOUBLE PRECISION NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessOwnership_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PartnerTransaction
CREATE TABLE "PartnerTransaction" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "type" "PartnerTransactionType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "businessId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable: OfficeExpense
CREATE TABLE "OfficeExpense" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "category" "ExpenseCat" NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CapitalContribution
CREATE TABLE "CapitalContribution" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" "CapitalType" NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapitalContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable: OfficeAllocationSetting
CREATE TABLE "OfficeAllocationSetting" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "allocationPct" DOUBLE PRECISION NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeAllocationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Partner_name_key" ON "Partner"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessOwnership_partnerId_businessId_effectiveDate_key" ON "BusinessOwnership"("partnerId", "businessId", "effectiveDate");

-- CreateIndex
CREATE INDEX "BusinessOwnership_partnerId_idx" ON "BusinessOwnership"("partnerId");

-- CreateIndex
CREATE INDEX "BusinessOwnership_businessId_idx" ON "BusinessOwnership"("businessId");

-- CreateIndex
CREATE INDEX "PartnerTransaction_partnerId_idx" ON "PartnerTransaction"("partnerId");

-- CreateIndex
CREATE INDEX "PartnerTransaction_businessId_idx" ON "PartnerTransaction"("businessId");

-- CreateIndex
CREATE INDEX "PartnerTransaction_date_idx" ON "PartnerTransaction"("date");

-- CreateIndex
CREATE INDEX "PartnerTransaction_type_idx" ON "PartnerTransaction"("type");

-- CreateIndex
CREATE INDEX "OfficeExpense_year_month_idx" ON "OfficeExpense"("year", "month");

-- CreateIndex
CREATE INDEX "OfficeExpense_date_idx" ON "OfficeExpense"("date");

-- CreateIndex
CREATE INDEX "CapitalContribution_partnerId_idx" ON "CapitalContribution"("partnerId");

-- CreateIndex
CREATE INDEX "CapitalContribution_date_idx" ON "CapitalContribution"("date");

-- CreateIndex
CREATE UNIQUE INDEX "OfficeAllocationSetting_businessId_effectiveDate_key" ON "OfficeAllocationSetting"("businessId", "effectiveDate");

-- CreateIndex
CREATE INDEX "OfficeAllocationSetting_businessId_idx" ON "OfficeAllocationSetting"("businessId");

-- AddForeignKey
ALTER TABLE "BusinessOwnership" ADD CONSTRAINT "BusinessOwnership_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessOwnership" ADD CONSTRAINT "BusinessOwnership_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerTransaction" ADD CONSTRAINT "PartnerTransaction_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerTransaction" ADD CONSTRAINT "PartnerTransaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapitalContribution" ADD CONSTRAINT "CapitalContribution_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeAllocationSetting" ADD CONSTRAINT "OfficeAllocationSetting_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed 4 Partners
INSERT INTO "Partner" ("id", "name", "createdAt") VALUES
  ('partner_saied', 'SAIED', CURRENT_TIMESTAMP),
  ('partner_adel', 'ADEL', CURRENT_TIMESTAMP),
  ('partner_moatasem', 'MOATASEM', CURRENT_TIMESTAMP),
  ('partner_moussa', 'MOUSSA', CURRENT_TIMESTAMP);
