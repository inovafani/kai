-- CreateTable
CREATE TABLE "ConversationBookingState" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "productExternalId" TEXT,
    "productTitle" TEXT,
    "dateText" TEXT,
    "guests" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationBookingState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationBookingState_conversationId_key" ON "ConversationBookingState"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationBookingState_tenantId_conversationId_idx" ON "ConversationBookingState"("tenantId", "conversationId");

-- AddForeignKey
ALTER TABLE "ConversationBookingState" ADD CONSTRAINT "ConversationBookingState_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
