-- AlterEnum
ALTER TYPE "BluePassLedgerKind" ADD VALUE 'PAYMENT_PROCESSING_ALLOCATION';

-- AlterTable
ALTER TABLE "BluePassLedgerEntry" ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "paidOutAt" TIMESTAMP(3),
ADD COLUMN     "paidOutBy" TEXT,
ADD COLUMN     "paidOutReference" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3);
