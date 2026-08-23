-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "ClientTier" AS ENUM ('VIP', 'LOYAL', 'NORMAL', 'DELINQUENT');

-- CreateEnum
CREATE TYPE "WorkStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'COMPLETED', 'PAUSED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('FULL', 'PARTIAL', 'UNPAID');

-- CreateEnum
CREATE TYPE "PoolTransactionType" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('FIXED', 'VARIABLE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "ClientTier" NOT NULL DEFAULT 'NORMAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ServiceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectRecord" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "customServiceText" TEXT,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "deposit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "remaining" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "workStatus" "WorkStatus" NOT NULL DEFAULT 'WAITING',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "designerId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolTransaction" (
    "id" TEXT NOT NULL,
    "projectRecordId" TEXT,
    "withdrawalId" TEXT,
    "amountSAR" DECIMAL(12,2) NOT NULL,
    "type" "PoolTransactionType" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoolTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "amountSAR" DECIMAL(12,2) NOT NULL,
    "exchangeRate" DECIMAL(12,4) NOT NULL,
    "commissionPct" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "netEGP" DECIMAL(14,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ProjectRecordToServiceType" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProjectRecordToServiceType_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Client_phone_key" ON "Client"("phone");

-- CreateIndex
CREATE INDEX "Client_name_idx" ON "Client"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceType_name_isCustom_key" ON "ServiceType"("name", "isCustom");

-- CreateIndex
CREATE INDEX "ProjectRecord_clientId_idx" ON "ProjectRecord"("clientId");

-- CreateIndex
CREATE INDEX "ProjectRecord_designerId_idx" ON "ProjectRecord"("designerId");

-- CreateIndex
CREATE INDEX "ProjectRecord_date_idx" ON "ProjectRecord"("date");

-- CreateIndex
CREATE UNIQUE INDEX "PoolTransaction_withdrawalId_key" ON "PoolTransaction"("withdrawalId");

-- CreateIndex
CREATE INDEX "PoolTransaction_projectRecordId_idx" ON "PoolTransaction"("projectRecordId");

-- CreateIndex
CREATE INDEX "PoolTransaction_type_idx" ON "PoolTransaction"("type");

-- CreateIndex
CREATE INDEX "PoolTransaction_date_idx" ON "PoolTransaction"("date");

-- CreateIndex
CREATE INDEX "Withdrawal_year_month_idx" ON "Withdrawal"("year", "month");

-- CreateIndex
CREATE INDEX "Withdrawal_date_idx" ON "Withdrawal"("date");

-- CreateIndex
CREATE INDEX "Expense_year_month_idx" ON "Expense"("year", "month");

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_idx" ON "ActivityLog"("userId");

-- CreateIndex
CREATE INDEX "ActivityLog_entityType_entityId_idx" ON "ActivityLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ActivityLog_timestamp_idx" ON "ActivityLog"("timestamp");

-- CreateIndex
CREATE INDEX "_ProjectRecordToServiceType_B_index" ON "_ProjectRecordToServiceType"("B");

-- AddForeignKey
ALTER TABLE "ProjectRecord" ADD CONSTRAINT "ProjectRecord_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRecord" ADD CONSTRAINT "ProjectRecord_designerId_fkey" FOREIGN KEY ("designerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolTransaction" ADD CONSTRAINT "PoolTransaction_projectRecordId_fkey" FOREIGN KEY ("projectRecordId") REFERENCES "ProjectRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolTransaction" ADD CONSTRAINT "PoolTransaction_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "Withdrawal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProjectRecordToServiceType" ADD CONSTRAINT "_ProjectRecordToServiceType_A_fkey" FOREIGN KEY ("A") REFERENCES "ProjectRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProjectRecordToServiceType" ADD CONSTRAINT "_ProjectRecordToServiceType_B_fkey" FOREIGN KEY ("B") REFERENCES "ServiceType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
