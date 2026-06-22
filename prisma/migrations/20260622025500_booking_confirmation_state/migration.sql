ALTER TABLE "ConversationBookingState"
ADD COLUMN "travellerName" TEXT,
ADD COLUMN "travellerEmail" TEXT,
ADD COLUMN "travellerPhone" TEXT,
ADD COLUMN "bookingStatus" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "confirmationSummary" TEXT,
ADD COLUMN "externalBookingId" TEXT,
ADD COLUMN "externalProvider" TEXT,
ADD COLUMN "bookingError" TEXT;
