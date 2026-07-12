import type { BluePassInquiryIntent } from "@/core/bluepass/intent";

export const bluePassRouterActions = [
  "VALUE_QUESTION",
  "SMALL_TALK",
  "SEASON_QUESTION",
  "DESTINATION_COMPARISON",
  "YACHT_COMPARISON",
  "RECOMMENDATION",
  "TRAVEL_INSPIRATION",
  "YACHT_INFO",
  "GENERAL_QUESTION",
  "BROWSE_OPTIONS",
  "REQUEST_MISSING_FIELDS",
  "CONFIRM_INQUIRY",
  "SUBMIT_INQUIRY"
] as const;

export type BluePassRouterAction = (typeof bluePassRouterActions)[number];

// Contact/PII fields (travellerName, travellerEmail, travellerPhone) are intentionally excluded:
// they gate real DB writes and WhatsApp dispatch to operators, so they stay regex-extracted from
// the traveller's literal text rather than trusted from model output.
export type BluePassRouterExtractedIntent = Pick<
  BluePassInquiryIntent,
  "destination" | "dateWindow" | "guests" | "budget" | "interests" | "tripType"
>;

export interface BluePassRouterDecision {
  action: BluePassRouterAction;
  intent: Partial<BluePassRouterExtractedIntent>;
  seasonDestination: "Komodo" | "Raja Ampat" | null;
  gratitude: boolean;
}

export interface BluePassRouterInput {
  latestMessage: string;
  priorTravellerMessages: string[];
  knownIntent: BluePassInquiryIntent;
  missingFields: string[];
  hasSelectedYacht: boolean;
  mentionedYachtNames: string[];
}

export interface BluePassRouterLlmClient {
  route(input: BluePassRouterInput): Promise<BluePassRouterDecision>;
}

function isBluePassRouterAction(value: unknown): value is BluePassRouterAction {
  return typeof value === "string" && (bluePassRouterActions as readonly string[]).includes(value);
}

export function parseBluePassRouterDecision(raw: string): BluePassRouterDecision | null {
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

  const action = typeof value.action === "string" ? value.action.trim().toUpperCase() : null;
  if (!isBluePassRouterAction(action)) return null;

  const intent: Partial<BluePassRouterExtractedIntent> = {};

  if (typeof value.destination === "string" && value.destination.trim()) {
    intent.destination = value.destination.trim().slice(0, 80);
  }
  if (typeof value.dateWindow === "string" && value.dateWindow.trim()) {
    intent.dateWindow = value.dateWindow.trim().slice(0, 80);
  }
  if (typeof value.guests === "number" && Number.isFinite(value.guests) && value.guests > 0) {
    intent.guests = Math.round(value.guests);
  }
  if (typeof value.budget === "string" && value.budget.trim()) {
    intent.budget = value.budget.trim().slice(0, 40);
  }
  if (typeof value.tripType === "string" && value.tripType.trim()) {
    intent.tripType = value.tripType.trim().slice(0, 40);
  }
  if (Array.isArray(value.interests)) {
    const interests = value.interests.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0
    );
    if (interests.length > 0) {
      intent.interests = interests.map((item) => item.trim().slice(0, 40)).slice(0, 8);
    }
  }

  const seasonDestination =
    value.seasonDestination === "Komodo" || value.seasonDestination === "Raja Ampat" ? value.seasonDestination : null;
  const gratitude = value.gratitude === true;

  return {
    action,
    intent,
    seasonDestination,
    gratitude
  };
}
