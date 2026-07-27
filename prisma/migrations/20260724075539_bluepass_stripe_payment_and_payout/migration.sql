-- CreateEnum
CREATE TYPE "BluePassPaymentIntentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BluePassOperatorPayoutStatus" AS ENUM ('PENDING_RELEASE', 'TRANSFERRED', 'FAILED');

-- CreateTable
CREATE TABLE "BluePassPaymentIntent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bluePassInquiryId" TEXT NOT NULL,
    "stripeCheckoutSessionId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "BluePassPaymentIntentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BluePassPaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BluePassOperatorPayout" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bluePassLedgerEntryId" TEXT NOT NULL,
    "stripeConnectAccountId" TEXT NOT NULL,
    "stripeTransferId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "BluePassOperatorPayoutStatus" NOT NULL DEFAULT 'PENDING_RELEASE',
    "releasedBy" TEXT,
    "releasedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BluePassOperatorPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BluePassPaymentIntent_stripeCheckoutSessionId_key" ON "BluePassPaymentIntent"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "BluePassPaymentIntent_stripePaymentIntentId_key" ON "BluePassPaymentIntent"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "BluePassPaymentIntent_tenantId_bluePassInquiryId_idx" ON "BluePassPaymentIntent"("tenantId", "bluePassInquiryId");

-- CreateIndex
CREATE INDEX "BluePassPaymentIntent_status_idx" ON "BluePassPaymentIntent"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BluePassOperatorPayout_bluePassLedgerEntryId_key" ON "BluePassOperatorPayout"("bluePassLedgerEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "BluePassOperatorPayout_stripeTransferId_key" ON "BluePassOperatorPayout"("stripeTransferId");

-- CreateIndex
CREATE INDEX "BluePassOperatorPayout_tenantId_status_idx" ON "BluePassOperatorPayout"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "BluePassPaymentIntent" ADD CONSTRAINT "BluePassPaymentIntent_bluePassInquiryId_fkey" FOREIGN KEY ("bluePassInquiryId") REFERENCES "BluePassInquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BluePassOperatorPayout" ADD CONSTRAINT "BluePassOperatorPayout_bluePassLedgerEntryId_fkey" FOREIGN KEY ("bluePassLedgerEntryId") REFERENCES "BluePassLedgerEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
