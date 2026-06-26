-- CreateEnum
CREATE TYPE "BluePassInquiryStatus" AS ENUM ('DRAFT', 'READY_TO_DISPATCH', 'OPERATOR_PENDING', 'OPERATOR_ACCEPTED', 'COUNTER_OFFERED', 'DECLINED', 'CLOSED');

-- CreateEnum
CREATE TYPE "BluePassLedgerKind" AS ENUM ('CREATOR_COMMISSION_ESTIMATE', 'BLUEPASS_PLATFORM_COMMISSION', 'CONSERVATION_ALLOCATION', 'OPERATOR_PAYOUT_PLACEHOLDER');

-- CreateEnum
CREATE TYPE "BluePassLedgerStatus" AS ENUM ('PENDING', 'FINALIZED', 'VOIDED');

-- CreateEnum
CREATE TYPE "BluePassOperatorDispatchStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "BluePassInquiry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "BluePassInquiryStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceChannel" TEXT NOT NULL DEFAULT 'WEB_WIDGET',
    "travellerName" TEXT,
    "travellerEmail" TEXT,
    "travellerPhone" TEXT,
    "destination" TEXT,
    "tripType" TEXT,
    "dateWindow" TEXT,
    "guests" INTEGER,
    "budget" TEXT,
    "interests" JSONB,
    "selectedYachtSlug" TEXT,
    "selectedYachtName" TEXT,
    "operatorId" TEXT,
    "operatorName" TEXT,
    "operatorPhone" TEXT,
    "notes" TEXT,
    "travellerMessage" TEXT NOT NULL,
    "referralPartnerId" TEXT,
    "referralLinkId" TEXT,
    "referralCode" TEXT,
    "referralRole" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BluePassInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BluePassInquiryEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "bluePassInquiryId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BluePassInquiryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BluePassLedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "bluePassInquiryId" TEXT NOT NULL,
    "kind" "BluePassLedgerKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "BluePassLedgerStatus" NOT NULL DEFAULT 'PENDING',
    "referralPartnerId" TEXT,
    "referralLinkId" TEXT,
    "referralCode" TEXT,
    "referralRole" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BluePassLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BluePassOperatorDispatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "bluePassInquiryId" TEXT NOT NULL,
    "status" "BluePassOperatorDispatchStatus" NOT NULL DEFAULT 'QUEUED',
    "operatorId" TEXT,
    "operatorName" TEXT,
    "operatorPhone" TEXT NOT NULL,
    "outboundText" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "failureReason" TEXT,
    "metadata" JSONB,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BluePassOperatorDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BluePassInquiry_tenantId_conversationId_status_createdAt_idx" ON "BluePassInquiry"("tenantId", "conversationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BluePassInquiry_tenantId_status_createdAt_idx" ON "BluePassInquiry"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BluePassInquiryEvent_tenantId_conversationId_createdAt_idx" ON "BluePassInquiryEvent"("tenantId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "BluePassInquiryEvent_bluePassInquiryId_createdAt_idx" ON "BluePassInquiryEvent"("bluePassInquiryId", "createdAt");

-- CreateIndex
CREATE INDEX "BluePassLedgerEntry_tenantId_conversationId_status_createdA_idx" ON "BluePassLedgerEntry"("tenantId", "conversationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BluePassLedgerEntry_bluePassInquiryId_status_idx" ON "BluePassLedgerEntry"("bluePassInquiryId", "status");

-- CreateIndex
CREATE INDEX "BluePassOperatorDispatch_tenantId_conversationId_status_cre_idx" ON "BluePassOperatorDispatch"("tenantId", "conversationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BluePassOperatorDispatch_bluePassInquiryId_createdAt_idx" ON "BluePassOperatorDispatch"("bluePassInquiryId", "createdAt");

-- AddForeignKey
ALTER TABLE "BluePassInquiryEvent" ADD CONSTRAINT "BluePassInquiryEvent_bluePassInquiryId_fkey" FOREIGN KEY ("bluePassInquiryId") REFERENCES "BluePassInquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BluePassLedgerEntry" ADD CONSTRAINT "BluePassLedgerEntry_bluePassInquiryId_fkey" FOREIGN KEY ("bluePassInquiryId") REFERENCES "BluePassInquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BluePassOperatorDispatch" ADD CONSTRAINT "BluePassOperatorDispatch_bluePassInquiryId_fkey" FOREIGN KEY ("bluePassInquiryId") REFERENCES "BluePassInquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
