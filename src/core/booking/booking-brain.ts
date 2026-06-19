export type BookingBrainIntent =
  | "CHECK_AVAILABILITY"
  | "BOOKING_INQUIRY"
  | "HUMAN_HANDOFF"
  | "GENERAL_QUESTION";

export type BookingBrainConfidence = "HIGH" | "MEDIUM" | "LOW";
export type BookingBrainMissingSlot = "product" | "date" | "guests";

export interface BookingBrainSlots {
  productHint: string | null;
  dateText: string | null;
  guests: number | null;
}

export interface BookingBrainResult {
  intent: BookingBrainIntent;
  confidence: BookingBrainConfidence;
  slots: BookingBrainSlots;
  missingSlots: BookingBrainMissingSlot[];
}

const PRODUCT_HINTS = ["Komodo Day Trip", "Private Charter", "Reef Day Snorkel"];

function findProductHint(message: string) {
  const lowerMessage = message.toLowerCase();

  return (
    PRODUCT_HINTS.find((product) => lowerMessage.includes(product.toLowerCase())) ??
    (lowerMessage.includes("komodo") ? "Komodo Day Trip" : null)
  );
}

function findDateText(message: string) {
  const lowerMessage = message.toLowerCase();
  const relativeDate = lowerMessage.match(/\b(today|tomorrow|tonight)\b/);
  if (relativeDate) {
    return relativeDate[1];
  }

  const isoDate = lowerMessage.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoDate) {
    return isoDate[0];
  }

  return null;
}

function findGuests(message: string) {
  const guestCount = message.match(/\b(\d{1,2})\s*(guest|guests|pax|people|person|persons)\b/i);
  if (!guestCount) {
    return null;
  }

  return Number(guestCount[1]);
}

function classifyIntent(message: string): BookingBrainIntent {
  const lowerMessage = message.toLowerCase();

  if (/\b(human|agent|operator|staff|person|refund|complaint)\b/.test(lowerMessage)) {
    return "HUMAN_HANDOFF";
  }

  if (/\b(available|availability|check|slot|spots?)\b/.test(lowerMessage)) {
    return "CHECK_AVAILABILITY";
  }

  if (/\b(book|booking|reserve|reservation|trips?|tours?|charters?|boats?)\b/.test(lowerMessage)) {
    return "BOOKING_INQUIRY";
  }

  return "GENERAL_QUESTION";
}

function getMissingSlots(intent: BookingBrainIntent, slots: BookingBrainSlots) {
  if (intent === "HUMAN_HANDOFF" || intent === "GENERAL_QUESTION") {
    return [];
  }

  const missingSlots: BookingBrainMissingSlot[] = [];
  if (!slots.productHint) {
    missingSlots.push("product");
  }
  if (!slots.dateText) {
    missingSlots.push("date");
  }
  if (!slots.guests) {
    missingSlots.push("guests");
  }

  return missingSlots;
}

function getConfidence(intent: BookingBrainIntent, missingSlots: BookingBrainMissingSlot[]) {
  if (intent === "HUMAN_HANDOFF") {
    return "HIGH";
  }

  if (missingSlots.length === 0) {
    return "HIGH";
  }

  return missingSlots.length === 3 ? "LOW" : "MEDIUM";
}

export function analyzeTravellerBookingMessage(message: string): BookingBrainResult {
  const intent = classifyIntent(message);
  const slots = {
    productHint: findProductHint(message),
    dateText: findDateText(message),
    guests: findGuests(message)
  };
  const missingSlots = getMissingSlots(intent, slots);

  return {
    intent,
    confidence: getConfidence(intent, missingSlots),
    slots,
    missingSlots
  };
}

export function composeBookingBrainReply(analysis: BookingBrainResult) {
  if (analysis.intent === "HUMAN_HANDOFF") {
    return "I can hand this to the team. I will keep the booking details grounded and avoid making changes until an operator reviews it.";
  }

  if (analysis.intent === "GENERAL_QUESTION") {
    return "I can help with Komodo tours, availability checks, booking inquiries, or handoff to the team.";
  }

  if (analysis.missingSlots.length > 0) {
    const missing = analysis.missingSlots;

    if (missing.join(",") === "product,date,guests") {
      return "I can help with that. Which tour, date, and number of guests should I check first?";
    }

    return `I can help with that. Please share the ${missing.join(", ")} so I can check safely.`;
  }

  return `I can check ${analysis.slots.productHint} for ${analysis.slots.guests} guest${
    analysis.slots.guests === 1 ? "" : "s"
  } on ${analysis.slots.dateText}. Next I will use the tenant PMS adapter before confirming anything.`;
}
