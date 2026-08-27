-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "ownerPhone" TEXT,
    "propertyType" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "listingType" TEXT NOT NULL DEFAULT 'RENT',
    "askingPrice" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "propertyId" TEXT,
    "dealType" TEXT NOT NULL,
    "dealValue" DOUBLE PRECISION,
    "totalCommission" DOUBLE PRECISION NOT NULL,
    "externalOfficeAmount" DOUBLE PRECISION,
    "personalAmount" DOUBLE PRECISION,
    "abomazenNetAmount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "seekerName" TEXT,
    "seekerPhone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Property_businessId_idx" ON "Property"("businessId");
CREATE INDEX "Property_status_idx" ON "Property"("status");
CREATE INDEX "Deal_businessId_idx" ON "Deal"("businessId");
CREATE INDEX "Deal_propertyId_idx" ON "Deal"("propertyId");
CREATE INDEX "Deal_date_idx" ON "Deal"("date");
CREATE INDEX "Deal_dealType_idx" ON "Deal"("dealType");

-- Add dealId column to PoolTransaction
ALTER TABLE "PoolTransaction" ADD COLUMN "dealId" TEXT;

-- CreateIndex
CREATE INDEX "PoolTransaction_dealId_idx" ON "PoolTransaction"("dealId");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PoolTransaction" ADD CONSTRAINT "PoolTransaction_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
