-- Phase 0.5: Multi-Business Architecture Migration
-- Safe step-by-step: nullable FK first → populate → enforce

-- ═══════════════════════════════════════════════════════
-- Step 1: Create enums
-- ═══════════════════════════════════════════════════════
CREATE TYPE "CurrencyMode" AS ENUM ('SAR_TO_EGP', 'EGP_DIRECT');
ALTER TYPE "Role" ADD VALUE 'SUPER_ADMIN';

-- ═══════════════════════════════════════════════════════
-- Step 2: Create Business table
-- ═══════════════════════════════════════════════════════
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "currencyMode" "CurrencyMode" NOT NULL DEFAULT 'SAR_TO_EGP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Business_name_key" ON "Business"("name");
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");
CREATE INDEX "Business_slug_idx" ON "Business"("slug");

-- ═══════════════════════════════════════════════════════
-- Step 3: Create the 3 businesses
-- ═══════════════════════════════════════════════════════
INSERT INTO "Business" ("id", "name", "slug", "currencyMode", "createdAt") VALUES
('biz_nexup',     'NEXUP',     'nexup',     'SAR_TO_EGP', CURRENT_TIMESTAMP),
('biz_rebound',   'REBOUND',   'rebound',   'EGP_DIRECT', CURRENT_TIMESTAMP),
('biz_abomazen',  'ABOMAZEN',  'abomazen',  'EGP_DIRECT', CURRENT_TIMESTAMP);

-- ═══════════════════════════════════════════════════════
-- Step 4: Add nullable businessId to all tables (safe — no data loss)
-- ═══════════════════════════════════════════════════════
ALTER TABLE "User" ADD COLUMN "businessId" TEXT;
ALTER TABLE "Client" ADD COLUMN "businessId" TEXT;
ALTER TABLE "ServiceType" ADD COLUMN "businessId" TEXT;
ALTER TABLE "ProjectRecord" ADD COLUMN "businessId" TEXT;
ALTER TABLE "PoolTransaction" ADD COLUMN "businessId" TEXT;
ALTER TABLE "Withdrawal" ADD COLUMN "businessId" TEXT;
ALTER TABLE "Expense" ADD COLUMN "businessId" TEXT;

-- ═══════════════════════════════════════════════════════
-- Step 5: Link ALL existing data to NEXUP
-- ═══════════════════════════════════════════════════════
UPDATE "User" SET "businessId" = 'biz_nexup' WHERE "businessId" IS NULL;
UPDATE "Client" SET "businessId" = 'biz_nexup' WHERE "businessId" IS NULL;
UPDATE "ServiceType" SET "businessId" = 'biz_nexup' WHERE "businessId" IS NULL;
UPDATE "ProjectRecord" SET "businessId" = 'biz_nexup' WHERE "businessId" IS NULL;
UPDATE "PoolTransaction" SET "businessId" = 'biz_nexup' WHERE "businessId" IS NULL;
UPDATE "Withdrawal" SET "businessId" = 'biz_nexup' WHERE "businessId" IS NULL;
UPDATE "Expense" SET "businessId" = 'biz_nexup' WHERE "businessId" IS NULL;

-- ═══════════════════════════════════════════════════════
-- Step 6: Promote admin user to SUPER_ADMIN
-- ═══════════════════════════════════════════════════════
UPDATE "User" SET "role" = 'SUPER_ADMIN' WHERE "email" = 'admin@nexup.local';

-- ═══════════════════════════════════════════════════════
-- Step 7: Make businessId NOT NULL (all data is now linked)
-- ═══════════════════════════════════════════════════════
ALTER TABLE "User" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Client" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "ServiceType" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "ProjectRecord" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "PoolTransaction" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Withdrawal" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Expense" ALTER COLUMN "businessId" SET NOT NULL;

-- ═══════════════════════════════════════════════════════
-- Step 8: Add Foreign Keys
-- ═══════════════════════════════════════════════════════
ALTER TABLE "User" ADD CONSTRAINT "User_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Client" ADD CONSTRAINT "Client_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceType" ADD CONSTRAINT "ServiceType_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectRecord" ADD CONSTRAINT "ProjectRecord_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PoolTransaction" ADD CONSTRAINT "PoolTransaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════
-- Step 9: Add indexes
-- ═══════════════════════════════════════════════════════
CREATE INDEX "User_businessId_idx" ON "User"("businessId");
CREATE INDEX "Client_businessId_idx" ON "Client"("businessId");
CREATE INDEX "ServiceType_businessId_idx" ON "ServiceType"("businessId");
CREATE INDEX "ProjectRecord_businessId_idx" ON "ProjectRecord"("businessId");
CREATE INDEX "PoolTransaction_businessId_idx" ON "PoolTransaction"("businessId");
CREATE INDEX "Withdrawal_businessId_idx" ON "Withdrawal"("businessId");
CREATE INDEX "Expense_businessId_idx" ON "Expense"("businessId");

-- ═══════════════════════════════════════════════════════
-- Step 10: Update unique constraints for multi-business
-- ═══════════════════════════════════════════════════════
-- Client: drop old unique on phone, add composite unique
ALTER TABLE "Client" DROP CONSTRAINT "Client_phone_key";
ALTER TABLE "Client" ADD CONSTRAINT "Client_businessId_phone_key" UNIQUE ("businessId", "phone");

-- ServiceType: drop old unique, add composite unique
ALTER TABLE "ServiceType" DROP CONSTRAINT "ServiceType_name_isCustom_key";
ALTER TABLE "ServiceType" ADD CONSTRAINT "ServiceType_businessId_name_isCustom_key" UNIQUE ("businessId", "name", "isCustom");
