import type { BluePassPersonaLead } from "./lead";

export type BluePassPersona = "TRAVELLER" | "OPERATOR" | "PARTNER" | "UNKNOWN";

export function classifyBluePassPersona(input: {
  messages: string[];
  identityPersona?: BluePassPersona | null;
}) {
  const joined = normalizePersonaText(input.messages.join("\n"));
  const latest = normalizePersonaText(input.messages[0] ?? "");

  if (input.identityPersona && !matchesStrongTravellerBookingSignal(latest)) {
    return input.identityPersona;
  }

  if (matchesStrongTravellerBookingSignal(latest)) return "TRAVELLER";
  if (matchesOperatorSignal(joined)) return "OPERATOR";
  if (matchesPartnerSignal(joined)) return "PARTNER";
  if (matchesTravellerSignal(joined)) return "TRAVELLER";

  return "UNKNOWN";
}

export function buildBluePassOperatorReply(input: { latestMessage: string; operatorName?: string | null }) {
  const normalized = normalizePersonaText(input.latestMessage);
  const name = input.operatorName?.trim();
  const greeting = name ? `${name} is recognised as a BluePass operator. ` : "";

  if (/\b(?:18|break ?down|fee|cut|take rate|commission)\b/.test(normalized)) {
    return `${greeting}BluePass keeps the commercial model simple: the operator keeps 82% of the booking value, and the BluePass side is 18% for marketplace distribution, Kai-assisted qualification, partner demand, and conservation-linked operations. Final payout and contracts still need the BluePass team.`;
  }

  if (/\b(?:benefit|why join|what do we get|what do i get|included|why bluepass)\b/.test(normalized)) {
    return `${greeting}BluePass helps operators get qualified ocean travellers without pretending availability is live. Kai explains your product, collects the right trip details, sends operator inquiries, and keeps travellers clear that final price, payment, and confirmation come from the operator.`;
  }

  if (/\b(?:claim|list my|list our|join|operator)\b/.test(normalized)) {
    return `${greeting}To connect an operator profile, BluePass needs the approved claim details, WhatsApp number, and claimed yacht slugs. Once approved, Kai can route matching inquiries to that operator phone instead of a test number.`;
  }

  return `${greeting}I can help with BluePass operator onboarding, claim status, operator inquiry replies, payout questions, or how Kai routes traveller inquiries to your WhatsApp.`;
}

export function buildBluePassPartnerReply(input: { latestMessage: string }) {
  const normalized = normalizePersonaText(input.latestMessage);

  if (/\b(?:commission|earn|percent|my cut|referral)\b/.test(normalized)) {
    return "BluePass partner commission is designed for people who refer or book for clients without adding a markup to the traveller. The traveller still gets the BluePass price signal, while partner attribution and payout terms are handled by the BluePass team before anything is final.";
  }

  if (/\b(?:komodo|raja ampat|catalog|catalogue|operators|boats|yachts)\b/.test(normalized)) {
    return "For partners, Kai can walk through the current BluePass regions and options, shortlist suitable yachts for a client, and prepare the operator inquiry once dates, group size, and traveller contact details are ready.";
  }

  if (/\b(?:claim|link|founding|terms)\b/.test(normalized)) {
    return "BluePass can set partners up with attribution links and founding terms through the team. Kai can capture the contact details, but commission setup and approval stay with BluePass humans.";
  }

  return "BluePass partners can refer or book for clients, use Kai to compare vetted ocean operators, and keep the client journey honest: no fake live availability, no card details in chat, and operator confirmation before final booking language.";
}

export function buildBluePassLeadCapturedReply(input: {
  persona: Extract<BluePassPersona, "OPERATOR" | "PARTNER">;
  lead: BluePassPersonaLead;
}) {
  const label = input.persona === "OPERATOR" ? "operator lead" : "partner lead";
  const details = [input.lead.name, input.lead.email, input.lead.phone].filter(Boolean).join(", ");

  return [
    `Saved this as a ${label}${details ? `: ${details}` : ""}.`,
    "BluePass can follow up from here, and Kai can still answer questions in this chat."
  ].join(" ");
}

function matchesPartnerSignal(value: string) {
  return [
    /\bdive shop\b/,
    /\btravel agen(?:t|cy)?\b/,
    /\btour agen(?:t|cy)?\b/,
    /\bbooking agen(?:t|cy)?\b/,
    /\bi'?m an agent\b/,
    /\brefer (?:or book )?(?:my )?clients?\b/,
    /\bmy clients?\b/,
    /\bcontent creator\b/,
    /\binfluencer\b/,
    /\btrip leader\b/,
    /\bdive club\b/,
    /\bbook for clients?\b/,
    /\bon behalf of clients?\b/,
    /\breferral link\b/,
    /\breferral commission\b/,
    /\breferral partner\b/,
    /\bpartner program\b/,
    /\bbecome a partner\b/,
    /\bhow do commissions work\b/,
    /\bcommission\b/
  ].some((pattern) => pattern.test(value));
}

function matchesOperatorSignal(value: string) {
  return [
    /\bi run (?:trips|boats|dive|a|an|the)\b/,
    /\bwe run\b/,
    /\bwe operate\b/,
    /\bi operate\b/,
    /\bi own (?:a|an)\b/,
    /\bour fleet\b/,
    /\bour boats?\b/,
    /\bour yacht\b/,
    /\bour liveaboard\b/,
    /\bmy liveaboard\b/,
    /\bmy dive cent(?:re|er)\b/,
    /\bmy dive resort\b/,
    /\blist my (?:business|boat)\b/,
    /\blist our\b/,
    /\bclaim my\b/,
    /\bclaim our\b/,
    /\bi'?m an operator\b/,
    /\bas an operator\b/,
    /\bjoin as an operator\b/
  ].some((pattern) => pattern.test(value));
}

function matchesTravellerSignal(value: string) {
  return [
    /\bplanning a trip\b/,
    /\bi want to (?:book|order|reserve)\b/,
    /\bkomodo\b/,
    /\braja ampat\b/,
    /\blabuan bajo\b/,
    /\bliveaboards?\b/,
    /\bdive\b/,
    /\bsnorkel\b/,
    /\bsail\b/,
    /\bsurf\b/,
    /\bmanta\b/,
    /\bhoneymoon\b/,
    /\bholiday\b/,
    /\bvacation\b/,
    /\byacht\b/,
    /\bcabin\b/,
    /\bcharter\b/
  ].some((pattern) => pattern.test(value));
}

function matchesStrongTravellerBookingSignal(value: string) {
  return (
    /\bi want to (?:book|order|reserve)\b/.test(value) ||
    (/\b(?:for|on)\b.*\b\d{1,3}\s*(?:guests?|people|pax)\b/.test(value) &&
      /\b(?:komodo|raja ampat|january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(
        value
      ))
  );
}

function normalizePersonaText(value: string) {
  return value
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
