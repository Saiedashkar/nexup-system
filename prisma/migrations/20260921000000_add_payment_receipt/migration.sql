-- Additive migration: new PaymentReceipt table only.
-- No existing column, table or row is modified. Existing data untouched.

CREATE TABLE "PaymentReceipt" (
    "id" TEXT NOT NULL,
    "clientPaymentId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedByUserId" TEXT,

    CONSTRAINT "PaymentReceipt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentReceipt_clientPaymentId_idx" ON "PaymentReceipt"("clientPaymentId");

ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_clientPaymentId_fkey" FOREIGN KEY ("clientPaymentId") REFERENCES "ClientPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
