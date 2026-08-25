-- CreateTable
CREATE TABLE "ClientPayment" (
    "id" TEXT NOT NULL,
    "projectRecordId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientPayment_projectRecordId_idx" ON "ClientPayment"("projectRecordId");

-- CreateIndex
CREATE INDEX "ClientPayment_date_idx" ON "ClientPayment"("date");

-- AddForeignKey
ALTER TABLE "ClientPayment" ADD CONSTRAINT "ClientPayment_projectRecordId_fkey" FOREIGN KEY ("projectRecordId") REFERENCES "ProjectRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Clean up corrupted Arabic data (???? entries) - reset to placeholder names
UPDATE "Client" SET name = 'Client' WHERE name LIKE '%?%';
UPDATE "ProjectRecord" SET "projectName" = 'Project' WHERE "projectName" LIKE '%?%';
UPDATE "ProjectRecord" SET "designerName" = NULL WHERE "designerName" LIKE '%?%';
