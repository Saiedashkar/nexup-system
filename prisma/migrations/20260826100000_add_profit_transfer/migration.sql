-- CreateTable
CREATE TABLE "ProfitTransfer" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfitTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfitTransfer_businessId_idx" ON "ProfitTransfer"("businessId");

-- CreateIndex
CREATE INDEX "ProfitTransfer_date_idx" ON "ProfitTransfer"("date");

-- AddForeignKey
ALTER TABLE "ProfitTransfer" ADD CONSTRAINT "ProfitTransfer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
