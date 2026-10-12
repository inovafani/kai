-- AlterEnum
ALTER TYPE "PmsBookingPaymentAttemptStatus" ADD VALUE 'AWAITING_OPERATOR';

-- AlterTable
ALTER TABLE "NativeBooking" ADD COLUMN     "operatorDeadlineAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "NativeBooking_status_operatorDeadlineAt_idx" ON "NativeBooking"("status", "operatorDeadlineAt");

