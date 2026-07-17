-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "whatsappPhone" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_tenantId_whatsappPhone_key" ON "Conversation"("tenantId", "whatsappPhone");

-- AlterTable
ALTER TABLE "TenantConfig" ADD COLUMN     "operatorKnowledgePack" JSONB NOT NULL DEFAULT '{}';
