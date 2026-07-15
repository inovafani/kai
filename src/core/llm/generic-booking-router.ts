import type { BookingBrainIntent } from "@/core/booking/booking-brain";

export const genericBookingRouterIntents = [
  "CHECK_AVAILABILITY",
  "BOOKING_INQUIRY",
  "PRODUCT_RECOMMENDATION",
  "HUMAN_HANDOFF",
  "GENERAL_QUESTION"
] as const satisfies readonly BookingBrainIntent[];

// Only classifies which of the 5 intents the message is - never extracts product/date/guest
// slots. Those three fields feed live, unattended PMS calls (getAvailability, and createBooking
// when bookingWriteEnabled is on), so - like BluePass excludes traveller PII from its router -
// they stay regex-extracted from the traveller's literal text rather than trusted from model
// output.
export interface GenericBookingRouterDecision {
  intent: BookingBrainIntent;
}

export interface GenericBookingRouterInput {
  tenantName: string;
  pmsProvider: string;
  latestMessage: string;
  priorTravellerMessages: string[];
  productTitles: string[];
  knownProductHint: string | null;
  knownDateText: string | null;
  knownGuests: number | null;
  missingSlots: string[];
}

export interface GenericBookingRouterLlmClient {
  route(input: GenericBookingRouterInput): Promise<GenericBookingRouterDecision>;
}

function isGenericBookingRouterIntent(value: unknown): value is BookingBrainIntent {
  return typeof value === "string" && (genericBookingRouterIntents as readonly string[]).includes(value);
}

export function parseGenericBookingRouterDecision(raw: string): GenericBookingRouterDecision | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;

  const intent = typeof value.intent === "string" ? value.intent.trim().toUpperCase() : null;
  if (!isGenericBookingRouterIntent(intent)) return null;

  return { intent };
}
