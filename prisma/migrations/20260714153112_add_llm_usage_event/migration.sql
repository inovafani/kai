-- CreateTable
CREATE TABLE "LlmUsageEvent" (
    "id" TEXT NOT NULL,
    "callType" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tenantName" TEXT,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "estimatedCostUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmUsageEvent_createdAt_idx" ON "LlmUsageEvent"("createdAt");

-- CreateIndex
CREATE INDEX "LlmUsageEvent_tenantName_createdAt_idx" ON "LlmUsageEvent"("tenantName", "createdAt");

-- CreateIndex
CREATE INDEX "LlmUsageEvent_callType_createdAt_idx" ON "LlmUsageEvent"("callType", "createdAt");
