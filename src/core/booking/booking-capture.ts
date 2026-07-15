import type { BookingMemoryState } from "./booking-memory";

export type BookingContactSlot = "name" | "email" | "phone";
export type BookingSlot = "product" | "date" | "guests";

export interface BookingCaptureDetails {
  productExternalId: string | null;
  productTitle: string | null;
  dateText: string | null;
  guests: number | null;
  travellerName: string | null;
  travellerEmail: string | null;
  travellerPhone: string | null;
}

export interface BookingCaptureResult {
  active: boolean;
  ready: boolean;
  missingBookingSlots: BookingSlot[];
  missingContactSlots: BookingContactSlot[];
  details: BookingCaptureDetails;
}

export interface EvaluateBookingCaptureInput {
  message: string;
  priorTravellerMessages?: string[];
  bookingMemory: BookingMemoryState | null;
}

// A bare affirmative ("yes", "yep", "sure") only means booking-confirmation when it is the WHOLE
// message - matches the same anchored pattern BluePass uses for the identical "traveller confirms
// with a short affirmative" case (isBluePassInquirySubmissionRequest), so an unrelated "yes" used
// mid-sentence elsewhere can't accidentally activate capture.
const affirmativeOnlyPattern = /^(?:yes|yep|yeah|yup|ok|okay|sure|sounds good|looks good)[.! ]*$/;

function hasBookingCaptureIntent(message: string) {
  const lowerMessage = message.toLowerCase().trim();

  if (affirmativeOnlyPattern.test(lowerMessage)) return true;

  return /\b(book it|book this|reserve it|reserve this|make the booking|confirm this|go ahead|proceed|i want (it|this|that)|want this|want that|take it|let'?s do it)\b/.test(
    lowerMessage
  );
}

function cleanName(name: string) {
  return name
    .replace(/\b(email|e-mail|phone|mobile|tel|telephone)\b.*$/i, "")
    .replace(/[,:;]+$/g, "")
    .trim();
}

function extractTravellerName(text: string) {
  const namedField = text.match(/\bname\s*[:=]\s*([a-z][a-z0-9 .'-]{1,60})/i);
  if (namedField) {
    return cleanName(namedField[1]);
  }

  const naturalName = text.match(/\b(?:my name is|name is|i am|i'm)\s+([a-z][a-z0-9 .'-]{1,60})/i);
  return naturalName ? cleanName(naturalName[1]) : null;
}

function extractTravellerEmail(text: string) {
  return text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ?? null;
}

function extractTravellerPhone(text: string) {
  const textWithoutIsoDates = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
  const fieldPhone = text.match(/\b(?:phone|mobile|tel|telephone)\s*[:=]?\s*(\+?\d[\d\s().-]{6,}\d)\b/i);
  if (fieldPhone) {
    return fieldPhone[1].trim();
  }

  return textWithoutIsoDates.match(/\+?\d[\d\s().-]{6,}\d/)?.[0].trim() ?? null;
}

function extractBareTravellerName(text: string) {
  const trimmed = text.trim().replace(/[.!?,;:]+$/g, "");

  if (!/^[a-z][a-z .'-]{1,60}$/i.test(trimmed)) return null;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return null;

  if (
    /\b(book|booking|ticket|option|extra|adult|child|infant|family|people|guest|guests|yes|no|thanks?|please|email|phone|mobile|pm|am)\b/i.test(
      trimmed
    )
  ) {
    return null;
  }

  return trimmed;
}

function getMissingBookingSlots(bookingMemory: BookingMemoryState | null) {
  return [
    bookingMemory?.productTitle ? null : "product",
    bookingMemory?.dateText ? null : "date",
    bookingMemory?.guests ? null : "guests"
  ].filter((slot): slot is BookingSlot => Boolean(slot));
}

function getMissingContactSlots(details: BookingCaptureDetails) {
  return [
    details.travellerName ? null : "name",
    details.travellerEmail ? null : "email",
    details.travellerPhone ? null : "phone"
  ].filter((slot): slot is BookingContactSlot => Boolean(slot));
}

export function evaluateBookingCapture(input: EvaluateBookingCaptureInput): BookingCaptureResult {
  const messages = [...(input.priorTravellerMessages ?? []), input.message];
  const active = messages.some(hasBookingCaptureIntent) || Boolean(input.bookingMemory?.ticketQuantities?.length);
  const contactText = messages.join("\n");
  const details = {
    productExternalId: input.bookingMemory?.productExternalId ?? null,
    productTitle: input.bookingMemory?.productTitle ?? null,
    dateText: input.bookingMemory?.dateText ?? null,
    guests: input.bookingMemory?.guests ?? null,
    travellerName:
      extractTravellerName(contactText) ??
      input.bookingMemory?.travellerName ??
      (active ? extractBareTravellerName(input.message) : null),
    travellerEmail: extractTravellerEmail(contactText) ?? input.bookingMemory?.travellerEmail ?? null,
    travellerPhone: extractTravellerPhone(contactText) ?? input.bookingMemory?.travellerPhone ?? null
  };
  const missingBookingSlots = getMissingBookingSlots(input.bookingMemory);
  const missingContactSlots = getMissingContactSlots(details);

  return {
    active,
    ready: active && missingBookingSlots.length === 0 && missingContactSlots.length === 0,
    missingBookingSlots,
    missingContactSlots,
    details
  };
}

export function composeBookingCaptureReply(capture: BookingCaptureResult) {
  if (capture.missingBookingSlots.length > 0) {
    return `I can prepare that booking request. Please share the ${capture.missingBookingSlots.join(
      ", "
    )} first so I can keep it accurate.`;
  }

  if (capture.missingContactSlots.length > 0) {
    return `I can prepare that booking request for ${capture.details.productTitle} on ${
      capture.details.dateText
    } for ${capture.details.guests} guest${
      capture.details.guests === 1 ? "" : "s"
    }. Please share your ${capture.missingContactSlots.join(", ")} so the operator can follow up.`;
  }

  return `Thanks, I have the details for ${capture.details.productTitle} on ${capture.details.dateText} for ${
    capture.details.guests
  } guest${capture.details.guests === 1 ? "" : "s"}. I will send this to the operator for confirmation.`;
}
