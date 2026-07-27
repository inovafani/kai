import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

// One-off local testing helper: creates a BluePassInquiry that's already at PAYMENT_READY
// (as if a traveller asked, the operator quoted a final price, the traveller approved it, and the
// operator sent payment instructions) - skips the real WhatsApp back-and-forth so you can jump
// straight to testing the "Pay now" -> Stripe Checkout -> webhook -> ledger flow.
//
// Usage: node scripts/seed-test-payment-ready-quote.mjs

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.create({
    data: {
      slug: `bluepass-stripe-smoke-${randomUUID()}`,
      name: "BluePass Stripe Smoke Test",
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://bluepass.co", "http://localhost:3001"],
      status: "ACTIVE"
    }
  });

  const conversation = await prisma.conversation.create({
    data: { tenantId: tenant.id, channel: "WEB_WIDGET" }
  });

  const grossPriceCents = 500000; // USD 5,000.00
  const conservationContributionCents = Math.round(grossPriceCents * 0.05);

  const inquiry = await prisma.bluePassInquiry.create({
    data: {
      tenantId: tenant.id,
      conversationId: conversation.id,
      status: "COUNTER_OFFERED",
      sourceChannel: "WEB_WIDGET",
      travellerName: "Test Traveller",
      travellerEmail: "test-traveller@example.com",
      travellerPhone: "+61400000000",
      destination: "Komodo",
      tripType: "liveaboard",
      dateWindow: "22 July 2026",
      guests: 2,
      budget: "USD 5,000",
      selectedYachtSlug: "alila-purnama",
      selectedYachtName: "Alila Purnama",
      operatorId: "operator_alila_purnama",
      operatorName: "Alila Purnama",
      operatorPhone: "6281234567199",
      travellerMessage: "Alila Purnama in Komodo for 2 guests on 22 July - Stripe smoke test."
    }
  });

  const quoteMetadata = {
    id: inquiry.id,
    inquiryId: inquiry.id,
    status: "READY_FOR_TRAVELLER",
    selectedYachtName: inquiry.selectedYachtName,
    operatorName: inquiry.operatorName,
    destination: inquiry.destination,
    dateWindow: inquiry.dateWindow,
    guests: inquiry.guests,
    currency: "USD",
    grossPriceCents,
    conservationContributionCents,
    inclusions: "Full board meals, snorkeling gear, national park fees",
    exclusions: "Flights, travel insurance, alcoholic beverages",
    terms: "30% deposit to confirm, balance due 14 days before departure",
    source: "operator_counter"
  };

  await prisma.bluePassInquiryEvent.create({
    data: {
      tenantId: tenant.id,
      conversationId: conversation.id,
      bluePassInquiryId: inquiry.id,
      type: "BLUEPASS_QUOTE_DRAFTED",
      fromStatus: "OPERATOR_PENDING",
      toStatus: "COUNTER_OFFERED",
      metadata: quoteMetadata
    }
  });

  await prisma.bluePassInquiryEvent.create({
    data: {
      tenantId: tenant.id,
      conversationId: conversation.id,
      bluePassInquiryId: inquiry.id,
      type: "BLUEPASS_QUOTE_APPROVED",
      fromStatus: "COUNTER_OFFERED",
      toStatus: "COUNTER_OFFERED",
      metadata: { quoteId: inquiry.id, previousQuoteStatus: "READY_FOR_TRAVELLER", nextQuoteStatus: "TRAVELLER_APPROVED" }
    }
  });

  await prisma.bluePassInquiryEvent.create({
    data: {
      tenantId: tenant.id,
      conversationId: conversation.id,
      bluePassInquiryId: inquiry.id,
      type: "OPERATOR_PAYMENT_READY",
      fromStatus: "COUNTER_OFFERED",
      toStatus: "COUNTER_OFFERED",
      metadata: { paymentText: "Slot held. Complete payment to confirm your booking." }
    }
  });

  console.log("Created a PAYMENT_READY test quote.");
  console.log(`  Quote / Inquiry id: ${inquiry.id}`);
  console.log(`  Gross price: USD ${(grossPriceCents / 100).toFixed(2)}`);
  console.log("");
  console.log("Open this in your browser (bluepass-app dev server must be running):");
  console.log(`  http://localhost:3001/quotes/${inquiry.id}`);
}

main()
  .catch((error) => {
    console.error(error.message ?? error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
