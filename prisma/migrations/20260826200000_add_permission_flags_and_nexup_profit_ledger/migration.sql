-- AlterTable: Add permission flags to User
ALTER TABLE "User" ADD COLUMN "canAccessNexup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "canAccessRebound" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "canAccessAbomazen" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "canAccessOfficeFinanceFull" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: NexupProfitLedger
CREATE TABLE "NexupProfitLedger" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NexupProfitLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NexupProfitLedger_partnerId_idx" ON "NexupProfitLedger"("partnerId");
CREATE INDEX "NexupProfitLedger_date_idx" ON "NexupProfitLedger"("date");

-- AddForeignKey
ALTER TABLE "NexupProfitLedger" ADD CONSTRAINT "NexupProfitLedger_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
