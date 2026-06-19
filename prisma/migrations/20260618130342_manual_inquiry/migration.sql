-- CreateEnum
CREATE TYPE "ManualInquiryStatus" AS ENUM ('OPEN', 'OPERATOR_NOTIFIED', 'CLOSED');

-- CreateTable
CREATE TABLE "ManualInquiry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "ManualInquiryStatus" NOT NULL DEFAULT 'OPEN',
    "productExternalId" TEXT,
    "productTitle" TEXT,
    "dateText" TEXT,
    "guests" INTEGER,
    "travellerMessage" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManualInquiry_tenantId_status_createdAt_idx" ON "ManualInquiry"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ManualInquiry_tenantId_conversationId_createdAt_idx" ON "ManualInquiry"("tenantId", "conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ManualInquiry" ADD CONSTRAINT "ManualInquiry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualInquiry" ADD CONSTRAINT "ManualInquiry_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
