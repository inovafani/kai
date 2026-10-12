-- CreateEnum
CREATE TYPE "NativeTripStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "NativeTicketKind" AS ENUM ('TICKET', 'EXTRA');

-- CreateEnum
CREATE TYPE "NativeDepartureStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "NativeBookingStatus" AS ENUM ('HELD', 'WAITING_OPERATOR', 'CONFIRMED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "externalOperatorId" TEXT;

-- CreateTable
CREATE TABLE "NativeTrip" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "durationMinutes" INTEGER NOT NULL,
    "meetingPoint" TEXT NOT NULL DEFAULT '',
    "photoUrls" TEXT[],
    "currency" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "status" "NativeTripStatus" NOT NULL DEFAULT 'DRAFT',
    "bookingMode" TEXT NOT NULL DEFAULT 'AUTO_BOOKING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NativeTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NativeTicketType" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "kind" "NativeTicketKind" NOT NULL DEFAULT 'TICKET',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NativeTicketType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NativeSchedule" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "daysOfWeek" INTEGER[],
    "localTime" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "validFrom" TEXT,
    "validUntil" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NativeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NativeDeparture" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "localTime" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "seats" INTEGER NOT NULL,
    "status" "NativeDepartureStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NativeDeparture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NativeBlackout" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tripId" TEXT,
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NativeBlackout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NativeBooking" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "departureId" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "ticketQuantities" JSONB NOT NULL,
    "extraQuantities" JSONB,
    "travellerName" TEXT NOT NULL,
    "travellerEmail" TEXT NOT NULL,
    "travellerPhone" TEXT,
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "NativeBookingStatus" NOT NULL DEFAULT 'HELD',
    "holdExpiresAt" TIMESTAMP(3) NOT NULL,
    "paymentAttemptId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NativeBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NativeTrip_tenantId_status_idx" ON "NativeTrip"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "NativeTicketType_tripId_kind_label_key" ON "NativeTicketType"("tripId", "kind", "label");

-- CreateIndex
CREATE INDEX "NativeSchedule_tripId_idx" ON "NativeSchedule"("tripId");

-- CreateIndex
CREATE INDEX "NativeDeparture_tenantId_localDate_idx" ON "NativeDeparture"("tenantId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "NativeDeparture_tripId_localDate_localTime_key" ON "NativeDeparture"("tripId", "localDate", "localTime");

-- CreateIndex
CREATE INDEX "NativeBlackout_tenantId_fromDate_idx" ON "NativeBlackout"("tenantId", "fromDate");

-- CreateIndex
CREATE UNIQUE INDEX "NativeBooking_paymentAttemptId_key" ON "NativeBooking"("paymentAttemptId");

-- CreateIndex
CREATE INDEX "NativeBooking_departureId_status_idx" ON "NativeBooking"("departureId", "status");

-- CreateIndex
CREATE INDEX "NativeBooking_tenantId_status_idx" ON "NativeBooking"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_externalOperatorId_key" ON "Tenant"("externalOperatorId");

-- AddForeignKey
ALTER TABLE "NativeTrip" ADD CONSTRAINT "NativeTrip_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeTicketType" ADD CONSTRAINT "NativeTicketType_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "NativeTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeSchedule" ADD CONSTRAINT "NativeSchedule_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "NativeTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeDeparture" ADD CONSTRAINT "NativeDeparture_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeDeparture" ADD CONSTRAINT "NativeDeparture_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "NativeTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeBlackout" ADD CONSTRAINT "NativeBlackout_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeBlackout" ADD CONSTRAINT "NativeBlackout_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "NativeTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeBooking" ADD CONSTRAINT "NativeBooking_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeBooking" ADD CONSTRAINT "NativeBooking_departureId_fkey" FOREIGN KEY ("departureId") REFERENCES "NativeDeparture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

