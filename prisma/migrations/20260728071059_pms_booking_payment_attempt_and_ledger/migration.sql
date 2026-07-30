-- CreateEnum
CREATE TYPE "PmsBookingPaymentAttemptStatus" AS ENUM ('AWAITING_PAYMENT', 'PAID_AWAITING_CONFIRM', 'CONFIRMED', 'PAYMENT_FAILED', 'CONFIRM_FAILED_REFUNDED', 'REFUND_FAILED');

-- AlterTable
ALTER TABLE "TenantConfig" ADD COLUMN     "adminWhatsAppPhone" TEXT;

-- CreateTable
CREATE TABLE "PmsBookingPaymentAttempt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "pmsProvider" "PmsProvider" NOT NULL,
    "productExternalId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "dateText" TEXT NOT NULL,
    "guests" INTEGER NOT NULL,
    "travellerName" TEXT NOT NULL,
    "travellerEmail" TEXT NOT NULL,
    "travellerPhone" TEXT,
    "ticketQuantities" JSONB,
    "extraQuantities" JSONB,
    "grossAmountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "externalBookingId" TEXT NOT NULL,
    "stripeCheckoutSessionId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "stripeRefundId" TEXT,
    "status" "PmsBookingPaymentAttemptStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "failureReason" TEXT,
    "adminAlertSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PmsBookingPaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmsBookingLedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "pmsBookingPaymentAttemptId" TEXT NOT NULL,
    "kind" "BluePassLedgerKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "BluePassLedgerStatus" NOT NULL DEFAULT 'PENDING',
    "referralPartnerId" TEXT,
    "referralLinkId" TEXT,
    "referralCode" TEXT,
    "referralRole" TEXT,
    "metadata" JSONB,
    "finalizedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "paidOutAt" TIMESTAMP(3),
    "paidOutReference" TEXT,
    "paidOutBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PmsBookingLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PmsBookingPaymentAttempt_stripeCheckoutSessionId_key" ON "PmsBookingPaymentAttempt"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "PmsBookingPaymentAttempt_stripePaymentIntentId_key" ON "PmsBookingPaymentAttempt"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "PmsBookingPaymentAttempt_tenantId_conversationId_createdAt_idx" ON "PmsBookingPaymentAttempt"("tenantId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "PmsBookingPaymentAttempt_status_idx" ON "PmsBookingPaymentAttempt"("status");

-- CreateIndex
CREATE INDEX "PmsBookingLedgerEntry_tenantId_conversationId_status_create_idx" ON "PmsBookingLedgerEntry"("tenantId", "conversationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PmsBookingLedgerEntry_pmsBookingPaymentAttemptId_status_idx" ON "PmsBookingLedgerEntry"("pmsBookingPaymentAttemptId", "status");

-- AddForeignKey
ALTER TABLE "PmsBookingLedgerEntry" ADD CONSTRAINT "PmsBookingLedgerEntry_pmsBookingPaymentAttemptId_fkey" FOREIGN KEY ("pmsBookingPaymentAttemptId") REFERENCES "PmsBookingPaymentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
