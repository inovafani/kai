import type { BluePassRequiredInquiryField } from "./intent";
import type { BluePassYachtCard, BluePassYachtCatalogItem } from "./catalog";

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
  const productLink = yacht.productUrl ? ` More details: ${yacht.productUrl}.` : "";

  return `${yacht.name} is a ${yacht.tier} BluePass preview yacht in ${yacht.region}, fitting up to ${yacht.maxGuests} guests across ${yacht.cabins} cabins. Price signal: ${yacht.priceSignal}.${charter}${productLink} I can help compare it with similar options, explain who it suits, or prepare an operator inquiry if you want to check real availability.`;
}

export function buildBluePassValueReply() {
  return "BluePass helps travellers choose from vetted ocean operators while keeping booking truth honest: catalog prices are signals until an operator confirms availability and the final quote. The BluePass promise is that trips support the ocean too - 5% is allocated toward conservation, clean-ups, and coastal community impact. Kai can explain options, compare yachts, collect the right inquiry details, and then hand the request to the operator instead of pretending a booking is confirmed.";
}

export function buildBluePassSeasonReply(destination: string) {
  if (/raja\s+ampat/i.test(destination)) {
    return "Raja Ampat is usually strongest from October to April, when liveaboard conditions are more reliable and the routes around Misool, Dampier Strait, and Wayag make more sense. It is remote, reef-forward, and best planned with enough lead time because operator schedules and cabins still need confirmation.";
  }

  return "Komodo is usually strongest from April to November, with June to September often excellent for dry-season cruising, dramatic island scenery, manta sites, and liveaboard routes from Labuan Bajo. Kai can use your dates, guest count, and style to narrow options, but availability and final price still need operator confirmation.";
}

export function buildBluePassYachtComparisonReply(yachts: BluePassYachtSummary[]) {
  const rows = yachts
    .slice(0, 3)
    .map((yacht) => {
      const charter = yacht.charterPriceSignal ? `; charter signal ${yacht.charterPriceSignal}` : "";

      return `${yacht.name}: ${yacht.tier} in ${yacht.region}, up to ${yacht.maxGuests} guests across ${yacht.cabins} cabins, ${yacht.priceSignal}${charter}.`;
    })
    .join(" ");

  return `${rows} The practical difference is route and fit: Komodo yachts suit Labuan Bajo, dramatic islands, and manta/liveaboard days; Raja Ampat yachts suit a more remote reef expedition. I can narrow this by dates, guest count, diving versus cruising style, and budget before preparing an operator inquiry.`;
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
  const priceParts = [
    yacht.priceSignal && yacht.priceSignal !== "Quote on request" ? yacht.priceSignal : null,
    yacht.charterPriceSignal
  ].filter((value): value is string => Boolean(value));
  const priceText = priceParts.length > 0 ? ` Price signal: ${priceParts.join(" or ")}.` : "";
  const cabinText = [yacht.cabins ? `${yacht.cabins} cabins` : null, yacht.maxGuests ? `up to ${yacht.maxGuests} guests` : null]
    .filter(Boolean)
    .join(", ");
  const intro = `Great choice - ${yacht.name} is ${articleFor(yacht.tier)}${yacht.tier ? ` ${yacht.tier}` : ""} phinisi in ${yacht.region}${cabinText ? ` (${cabinText})` : ""}.${priceText}`;
  const bookingTruth =
    "I can't check the live calendar or take payment myself here, but I can prepare this for the operator to confirm availability and pricing.";

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
    return `Got it for ${yacht.name}. ${bookingTruth} Could you share your ${formatNaturalList(contactFields)} so the operator can follow up?`;
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
