import type { BluePassRequiredInquiryField } from "./intent";
import type { BluePassYachtCard, BluePassYachtCatalogItem } from "./catalog";
import { bluePassVesselNoun } from "./market";

type BluePassYachtSummary = Pick<
  BluePassYachtCard,
  "name" | "region" | "tier" | "maxGuests" | "cabins" | "priceSignal" | "charterPriceSignal" | "productUrl"
>;

const fieldLabels: Record<BluePassRequiredInquiryField, string> = {
  destination: "destination",
  dateWindow: "date window",
  guests: "guest count",
  travellerName: "name",
  travellerEmail: "email",
  travellerPhone: "phone"
};

export function buildBluePassMissingFieldsReply(input: {
  destination?: string;
  selectedYacht?: BluePassYachtCatalogItem | null;
  missingFields: BluePassRequiredInquiryField[];
}) {
  if (input.selectedYacht) {
    return buildSelectedYachtMissingFieldsReply({
      yacht: input.selectedYacht,
      missingFields: input.missingFields
    });
  }

  const missing = formatFieldList(input.missingFields);
  const context = input.destination ? ` for ${input.destination}` : "";

  return `I found BluePass preview yacht matches${context}. Please share your ${missing} so I can prepare the inquiry for operator confirmation.`;
}

export function buildBluePassInquiryReadyReply(input: {
  inquiryId: string;
  selectedYachtName?: string | null;
  dispatchQueued: boolean;
  dispatchFailed?: boolean;
}) {
  const target = input.selectedYachtName ? ` for ${input.selectedYachtName}` : "";
  const dispatch = input.dispatchFailed
    ? "I saved the inquiry, but the operator WhatsApp could not be sent from this environment. BluePass needs to check the WhatsApp configuration before the operator receives it."
    : input.dispatchQueued
    ? "I also queued the operator WhatsApp follow-up."
    : "The inquiry is ready for BluePass operator routing.";

  return `I prepared BluePass inquiry ${input.inquiryId}${target}. ${dispatch} This is not a confirmed booking; availability, final price, and payment wait for operator confirmation.`;
}

export function buildBluePassInquiryConfirmationReply(input: {
  selectedYachtName?: string | null;
  destination?: string;
  dateWindow?: string;
  guests?: number;
  travellerName?: string;
  travellerEmail?: string;
  travellerPhone?: string;
}) {
  const yacht = input.selectedYachtName ? ` for ${input.selectedYachtName}` : "";
  const destination = input.destination ? ` in ${input.destination}` : "";
  const trip = [input.dateWindow, input.guests ? `${input.guests} guests` : null].filter(Boolean).join(", ");
  const contact = [input.travellerName, input.travellerEmail, input.travellerPhone].filter(Boolean).join(", ");
  const tripSentence = trip ? ` I have the trip details as ${trip}.` : "";
  const contactSentence = contact ? ` Contact details: ${contact}.` : "";

  return `I can prepare a BluePass operator inquiry${yacht}${destination}.${tripSentence}${contactSentence} Before I send this to the operator, please confirm: should I send this inquiry now?`;
}

export function buildBluePassInquiryStatusReply(input: {
  inquiryId: string;
  selectedYachtName?: string | null;
  status: string;
}) {
  const target = input.selectedYachtName ? ` for ${input.selectedYachtName}` : "";
  const normalizedStatus = input.status.replace(/_/g, " ").toLowerCase();

  return `Your BluePass inquiry ${input.inquiryId}${target} is currently ${normalizedStatus}. If it is operator pending, the operator still needs to confirm availability, final price, and booking readiness before any payment or confirmed booking language is appropriate.`;
}

export function buildBluePassYachtOverviewReply(yacht: BluePassYachtCard) {
  const charter = yacht.charterPriceSignal ? ` Charter signal: ${yacht.charterPriceSignal}.` : "";

  return `${yacht.name} is a ${yacht.tier} BluePass preview ${bluePassVesselNoun(yacht.region)} in ${yacht.region}, up to ${yacht.maxGuests} guests across ${yacht.cabins} cabins. Price signal: ${yacht.priceSignal}.${charter} I can compare it with similar boats or prepare an operator inquiry to check real availability.`;
}

export function buildBluePassRecommendationReply(input: {
  destination?: string;
  matches: BluePassYachtSummary[];
  excludedYachtNames?: string[];
}) {
  const destination = input.destination ? ` in ${input.destination}` : "";
  const excluded = input.excludedYachtNames?.length
    ? ` besides ${formatNaturalList(input.excludedYachtNames)}`
    : "";
  const matches = input.matches.slice(0, 3);

  if (matches.length === 0) {
    return `I can help shortlist BluePass liveaboards${destination}. Tell me your travel style, dates, and group size, and I will narrow the options before preparing any operator inquiry.`;
  }

  const rows = matches
    .map((yacht, index) => {
      const capacity = `${yacht.cabins} cabins, up to ${yacht.maxGuests} guests`;
      const link = yacht.productUrl ? ` Details: ${yacht.productUrl}` : "";

      return `${index + 1}. ${yacht.name} - ${yacht.tier} in ${yacht.region}, ${capacity}. Price signal: ${yacht.priceSignal}.${link}`;
    })
    .join("\n");

  const intro = input.destination
    ? `Good BluePass liveaboard options${destination}${excluded}:`
    : `Here is what BluePass can speak to directly in ${formatNaturalList(Array.from(new Set(matches.map((yacht) => yacht.region))))}${excluded}:`;

  return `${intro}\n${rows}\n\nI can compare these, explain who each yacht suits, or narrow them by dates, group size, diving versus cruising style, and budget before preparing an operator inquiry.`;
}

export function buildBluePassOpenQuestionReply() {
  return "Happy to help with that. BluePass covers a growing set of vetted liveaboard trips, so I might not have live details on absolutely everything, but I can talk it through and help you compare real BluePass options whenever you are ready.";
}

export function buildBluePassValueReply() {
  return "BluePass lets travellers book vetted ocean operators, honestly: catalog prices are signals until the operator confirms. Every trip gives back - 5% goes to reef conservation and coastal communities. I can explain options, compare yachts, and prepare an operator inquiry - never fake a confirmed booking.";
}

// Real, public numbers - safe to state plainly to anyone who asks (traveller, operator, or
// partner), not just the operator/partner onboarding playbooks in triage.ts. Persona classification
// is sticky/first-signal-wins (see classifyBluePassPersona), so a traveller-flavored opener can lock
// out ever reaching those playbooks in the same conversation - this keeps the commission figures
// factually answerable regardless of what persona got locked in.
export function buildBluePassCommissionReply() {
  return "BluePass takes a capped 18% total: 5% funds reef conservation, 5% goes to partners who refer guests, 3% covers payment processing, and 5% is the platform fee. Operators keep 82% of their own rate, and guests never pay more than booking direct.";
}

export function buildBluePassSmallTalkReply(input?: { gratitude?: boolean }) {
  if (input?.gratitude) {
    return "Anytime. I can keep helping with this inquiry, compare other BluePass options, or start a fresh one when you are ready.";
  }

  return "Hey, I am here. I can talk through BluePass, compare liveaboards, recommend options that fit what you're after, or help continue an inquiry when you are ready.";
}

export function buildBluePassSeasonReply(destination: string) {
  const d = destination.toLowerCase();

  if (/great\s+barrier|gbr|cairns|port\s+douglas/.test(d)) {
    return "The Great Barrier Reef runs year-round, with June to October (dry season) the pick for clear, calm water - November to May is stinger season, so trips run with stinger suits. Dates, guests, and style and I'll narrow it; availability and final price still need operator confirmation.";
  }
  if (/ningaloo|exmouth/.test(d)) {
    return "Ningaloo is best March to August, when whale sharks are on the reef (humpbacks roughly July to November), with calm mornings out of Exmouth. Tell me your dates and group and I'll narrow it - availability and final price still need operator confirmation.";
  }
  if (/whitsunday|airlie/.test(d)) {
    return "The Whitsundays run year-round, with August to October the sweet spot - calm, dry, warm sailing across the 74 islands and Whitehaven Beach. Dates and group size and I'll narrow it; availability and final price still need operator confirmation.";
  }
  if (/raja\s+ampat/.test(d)) {
    return "Raja Ampat is usually strongest October to April, when liveaboard conditions are more reliable around Misool, the Dampier Strait, and Wayag. It is remote and reef-forward - best planned with lead time, and availability and final price still need operator confirmation.";
  }
  if (/komodo|labuan\s+bajo|flores/.test(d)) {
    return "Komodo is usually strongest April to November, with June to September excellent for dry-season cruising, manta sites, and liveaboard routes from Labuan Bajo. I can narrow by your dates, guests, and style, but availability and final price still need operator confirmation.";
  }

  return `I don't have detailed seasonal notes for ${destination} memorized yet, but I can check with the operator directly once I have your dates and guest count.`;
}

export function buildBluePassDestinationComparisonReply(regions: string[] = ["Komodo", "Raja Ampat"]) {
  if (regions.length === 2 && regions.includes("Komodo") && regions.includes("Raja Ampat")) {
    return [
      "Komodo and Raja Ampat are both strong BluePass regions, but they fit different trips.",
      "Komodo is easier to reach from Labuan Bajo and better for dramatic islands, shorter liveaboards, mantas, current diving, and a mix of cruising plus topside scenery.",
      "Raja Ampat is more remote from Sorong and better for reef biodiversity, soft coral, Misool or Wayag routes, and longer expedition-style trips. If this is your first Indonesia liveaboard, Komodo is usually simpler; if the goal is the richest reef trip, Raja Ampat is the one to compare first."
    ].join(" ");
  }

  return `I can walk through what's different between ${formatNaturalList(regions)}, but I don't have detailed side-by-side notes memorized for that pairing yet - tell me what matters most (trip style, length, budget) and I will compare what actually fits.`;
}

export function buildBluePassYachtComparisonReply(yachts: BluePassYachtSummary[]) {
  const shortlist = yachts.slice(0, 3);
  const rows = shortlist
    .map((yacht) => `${yacht.name}: ${yacht.tier}, ${yacht.region}, ${yacht.maxGuests} guests.`)
    .join(" ");

  // Route hint follows the ACTUAL regions being compared - never name-drop Komodo/Raja on an
  // Australian (or mixed) comparison.
  const regions = [...new Set(shortlist.map((yacht) => yacht.region).filter(Boolean))];
  const routeHint =
    regions.length === 0
      ? "Route and fit differ."
      : regions.length === 1
        ? `Route and fit differ within ${regions[0]}.`
        : `Route and fit differ across ${formatNaturalList(regions)}.`;

  return `${rows} ${routeHint} Narrow by dates and guests before an operator inquiry?`;
}

function formatFieldList(fields: BluePassRequiredInquiryField[]) {
  const labels = fields.map((field) => fieldLabels[field]);
  if (labels.length <= 1) return labels[0] ?? "details";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function buildSelectedYachtMissingFieldsReply(input: {
  yacht: BluePassYachtCatalogItem;
  missingFields: BluePassRequiredInquiryField[];
}) {
  const yacht = input.yacht;
  const primaryPrice =
    yacht.priceSignal && yacht.priceSignal !== "Quote on request" ? yacht.priceSignal : yacht.charterPriceSignal;
  const priceText = primaryPrice ? ` Price signal: ${primaryPrice}.` : "";
  const cabinText = [yacht.cabins ? `${yacht.cabins} cabins` : null, yacht.maxGuests ? `up to ${yacht.maxGuests} guests` : null]
    .filter(Boolean)
    .join(", ");
  const vessel = bluePassVesselNoun(yacht.region);
  const intro = `Great choice - ${yacht.name} is ${articleFor(yacht.tier)}${yacht.tier ? ` ${yacht.tier}` : ""} ${vessel} in ${yacht.region}${cabinText ? ` (${cabinText})` : ""}.${priceText}`;
  const bookingTruth =
    "I can't check live availability or take payment here, but I can prepare this for the operator to confirm.";

  if (input.missingFields.includes("dateWindow") || input.missingFields.includes("guests")) {
    const fields = [
      input.missingFields.includes("dateWindow") ? "dates" : null,
      input.missingFields.includes("guests") ? "group size" : null
    ].filter((value): value is string => Boolean(value));

    return `${intro} ${bookingTruth} Could you share your ${formatNaturalList(fields)}?`;
  }

  const contactFields = [
    input.missingFields.includes("travellerName") ? "name" : null,
    input.missingFields.includes("travellerEmail") ? "email" : null,
    input.missingFields.includes("travellerPhone") ? "WhatsApp number" : null
  ].filter((value): value is string => Boolean(value));

  if (contactFields.length > 0) {
    if (input.missingFields.includes("travellerPhone")) {
      return `Got it for ${yacht.name}. ${bookingTruth} Please fill the contact details form below so the operator can follow up.`;
    }

    return `Got it for ${yacht.name}. ${bookingTruth} Please share your ${formatNaturalList(contactFields)} when you want me to prepare the operator inquiry. I already have this WhatsApp number for follow-up.`;
  }

  return `${intro} ${bookingTruth}`;
}

function formatNaturalList(values: string[]) {
  if (values.length <= 1) return values[0] ?? "details";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function articleFor(value?: string | null) {
  if (!value) return "a";

  return /^[aeiou]/i.test(value) ? "an" : "a";
}
