import type { BluePassRequiredInquiryField } from "./intent";
import type { BluePassLead } from "./lead";

/**
 * BluePass first-touch triage.
 *
 * Three kinds of people reach Kai on the BluePass marketplace surface:
 * travellers (the booking flow), operators (want to list their business),
 * and partners (dive shops, agencies, creators who refer or book for
 * clients). This module classifies who we are talking to from the message
 * history alone — no stored state, persona re-derives every turn — and
 * builds the deterministic onboarding replies for the operator and partner
 * playbooks. Travellers fall through to the existing marketplace flow.
 *
 * Decision-tree spec (shared with the bluepass app):
 * BluePass Build/docs/kai-triage-decision-matrix.md
 */

export type BluePassPersona = "TRAVELLER" | "OPERATOR" | "PARTNER" | "UNKNOWN";

export type BluePassPersonaReply = {
  reply: string;
  /** Flow should attach catalog preview cards to this reply. */
  showCatalog?: boolean;
  /** Narrow attached cards to one destination when set. */
  catalogDestination?: "Komodo" | "Raja Ampat" | null;
};

// Identity nouns that mark a referral partner. Checked BEFORE operator
// phrases so "I run a dive shop" lands on PARTNER (shops refer; they do
// not operate boats). Never use bare "partner" — travellers say "my
// partner and I". Never use bare "referral" — travellers paste referral
// codes.
const partnerSignals = [
  "dive shop",
  "travel agen",
  "tour agen",
  "booking agen",
  "i'm an agent",
  "im an agent",
  "refer or book for clients",
  "refer clients",
  "refer my clients",
  "i refer",
  "my clients",
  "my audience",
  "i'm a creator",
  "im a creator",
  "content creator",
  "influencer",
  "trip leader",
  "dive club",
  "book for clients",
  "on behalf of clients",
  "referral link",
  "referral commission",
  "referral partner",
  "partner program",
  "become a partner",
  "how do commissions work",
  "commission"
];

// Verb-anchored operator phrases — someone who RUNS the boats, dives, or
// stays. Kept specific so traveller phrasings ("my partner", "our trip")
// never match.
const operatorSignals = [
  "i run trips",
  "run trips or charters",
  "i run a",
  "i run an",
  "i run the",
  "i run boats",
  "i run dive",
  "we run",
  "we operate",
  "i operate",
  "i own a",
  "i own an",
  "our fleet",
  "our boats",
  "our yacht",
  "our liveaboard",
  "my liveaboard",
  "my dive centre",
  "my dive center",
  "my dive resort",
  "list my business",
  "list our",
  "list my boat",
  "claim my",
  "claim our",
  "i'm an operator",
  "im an operator",
  "as an operator",
  "join as an operator"
];

const travellerSignals = [
  "planning a trip",
  "komodo",
  "raja ampat",
  "labuan bajo",
  "liveaboard",
  "dive",
  "snorkel",
  "sail",
  "surf",
  "manta",
  "honeymoon",
  "holiday",
  "vacation",
  "yacht",
  "cabin",
  "charter"
];

function joinedLower(messages: string[]) {
  return messages.join(" \n ").toLowerCase();
}

function includesAny(haystack: string, needles: string[]) {
  return needles.some((needle) => haystack.includes(needle));
}

/**
 * Classify the persona from the whole conversation. Operator/partner are
 * sticky: once someone says who they are, later vague messages ("tell me
 * more") keep the persona. "I run a dive shop" is PARTNER, not OPERATOR —
 * partner identity nouns win over operator verb phrases.
 */
export function classifyBluePassPersona(messages: string[]): BluePassPersona {
  const text = joinedLower(messages);
  if (text.trim().length === 0) return "UNKNOWN";

  if (includesAny(text, partnerSignals)) return "PARTNER";
  if (includesAny(text, operatorSignals)) return "OPERATOR";
  if (includesAny(text, travellerSignals)) return "TRAVELLER";

  return "UNKNOWN";
}

/**
 * First-touch triage greeting for a message with no persona or trip signal
 * at all ("hi", "info?"). The three options ride in the sentence because
 * the widget has no suggestion chips.
 */
export function buildBluePassTriageGreeting() {
  return "Hey - Kai here, the BluePass concierge. Quick one so I point you the right way: are you planning a trip, do you run boats or dive trips, or do you book and refer for clients?";
}

/**
 * True when the conversation gives Kai nothing to act on yet — no persona,
 * no trip intent, no question the marketplace flow already answers — so
 * the triage greeting is the most useful reply.
 */
export function shouldSendBluePassTriageGreeting(input: {
  persona: BluePassPersona;
  missingFields: BluePassRequiredInquiryField[];
  hasIntentSignal: boolean;
}) {
  return input.persona === "UNKNOWN" && !input.hasIntentSignal && input.missingFields.length > 0;
}

// ─── Lead captured (terminal node of both playbooks) ─────────────────────────

/**
 * The moment an operator or partner hands over a reachable channel, Kai
 * acknowledges exactly what it captured (so mistakes surface) and says what
 * happens next. This outranks every keyword branch — never re-ask for what
 * was just given.
 */
export function buildBluePassLeadCapturedReply(input: {
  persona: Extract<BluePassPersona, "OPERATOR" | "PARTNER">;
  lead: BluePassLead;
}): string {
  const captured = [
    input.lead.company ?? null,
    input.lead.region ?? null,
    input.lead.email ?? null,
    input.lead.phone ? `WhatsApp ${input.lead.phone}` : null
  ].filter((value): value is string => Boolean(value));

  const echo = captured.length > 0 ? `I've got you down as ${captured.join(", ")} - shout if any of that's off. ` : "";

  if (input.persona === "OPERATOR") {
    return `Perfect. ${echo}The team will verify the business and send your claim link to that address, usually same day. If your page is already pre-built, claiming it is one click - no password, and it's yours to run.`;
  }

  return `Perfect. ${echo}The team will send your partner claim link there, usually same day - one click, no password, and your tracked link is live. Founding-cohort terms get locked at that point too.`;
}

// ─── Operator playbook ────────────────────────────────────────────────────────

export function buildBluePassOperatorReply(input: {
  latestMessage: string;
  pitched: boolean;
}): BluePassPersonaReply {
  const message = input.latestMessage.toLowerCase();
  const has = (...needles: string[]) => includesAny(message, needles);

  if (has("18", "break down", "breakdown", "fee", "cut", "take rate", "commission")) {
    return {
      reply:
        "Every point of it: 5% funds conservation in your own waters - co-brandable, your guests see it. 5% pays the partners and creators sending you guests. 3% is payment processing. 5% runs BluePass. You keep 82%, there are no listing fees and no subscription - we only earn when you do. Want me to line up the claim link, or walk through vetting first?"
    };
  }

  if (has("what do we get", "what do i get", "why join", "benefit", "what's included", "why bluepass")) {
    return {
      reply:
        "A proper page, inquiries over web and WhatsApp, and me - I pre-qualify your guests before they reach you, so you talk to people ready to book, not tyre-kickers. Behind that: a partner network sending you bookings and a verified conservation story on every trip. What do you run, and where from?"
    };
  }

  if (has("outside", "not in indonesia", "add us to the list")) {
    return {
      reply:
        "Straight answer: we're Indonesia-first and expanding, and I'd rather put you on the expansion list than promise a launch date I can't back. Leave your company, region, and best email, and you're first in when we open your waters."
    };
  }

  if (has("indonesia")) {
    return {
      reply:
        "Then there's a decent chance your page already exists - we pre-built pages for hundreds of Indonesian operators. The claim link goes to the email on file for your business: one click, no password. Tell me your company name, home port, and best email, and the team sends it over."
    };
  }

  if (has("vet", "green fins", "approval", "requirement", "qualify")) {
    return {
      reply:
        "We check three things: safety record, sustainability (Green Fins where it applies), and fair local pay. That's what keeps the network worth being in. Approval is a team call - I won't promise it, but I'll get you in front of them. Company name and email?"
    };
  }

  if (has("payout", "paid out", "get paid", "contract", "bank")) {
    return {
      reply:
        "That one's for the humans - payout terms and contracts get sorted directly with the team, not me. Leave your company and email or WhatsApp and they'll come back to you, usually same day."
    };
  }

  if (has("claim")) {
    return {
      reply:
        "Easy. The claim link goes to the email on file for your business - one click, no password, and your page is yours to run. I just need your company name and home port so the team matches you to the right page. What's the name?"
    };
  }

  if (input.pitched) {
    return {
      reply:
        "Happy to go deeper on anything - the split, vetting, what your page looks like. The fastest path, though: company name, home port, and best email, and the team takes it from there."
    };
  }

  return {
    reply:
      "Good timing - we're onboarding operators now. The deal, straight up: you keep 82% of your own rate. Our 18% is capped and itemised - 5% conservation in your waters, 5% to the partners sending you guests, 3% payments, 5% platform - and your guests' price is never marked up. Where do you operate, and what do you run?"
  };
}

// ─── Partner playbook ─────────────────────────────────────────────────────────

export function buildBluePassPartnerReply(input: {
  latestMessage: string;
  pitched: boolean;
}): BluePassPersonaReply {
  const message = input.latestMessage.toLowerCase();
  const has = (...needles: string[]) => includesAny(message, needles);

  // Destination first: "Komodo for my clients" is a book-on-behalf brief,
  // not a generic client question.
  if (has("komodo")) {
    return {
      reply:
        "Komodo it is - mantas at Karang Makassar, the drift at Castle Rock, dragons on Rinca between dives. Season runs September to April, mantas peaking December to February. A couple I'd shortlist for clients are below - tell me their dates and group size and I'll narrow it.",
      showCatalog: true,
      catalogDestination: "Komodo"
    };
  }

  if (has("raja ampat", "raja")) {
    return {
      reply:
        "Good taste - Raja Ampat is the richest reef system on the planet, best October to April. Longer runs, bigger boats, out of Sorong. A couple I'd shortlist for clients are below - give me dates and group size and I'll match properly.",
      showCatalog: true,
      catalogDestination: "Raja Ampat"
    };
  }

  if (has("conservation", "impact", "reef", "5%")) {
    return {
      reply:
        "5% of every booking funds verified conservation where your clients actually travel - reef restoration, mangrove nurseries, manta research. It's tracked per booking, so you can tell a client their trip funded something real - and it's yours to co-brand in your own marketing."
    };
  }

  if (has("commission", "earn", "percent", "my cut", "%")) {
    return {
      reply:
        "Simple mechanics: your client pays the operator's own rate - never a cent more. The operator pays BluePass a capped commission, and your cut comes out of that. So recommending us never costs your client anything, which makes it an easy sell. Exact percentages are set per partner and locked for founding members - the team confirms yours. Attribution runs off your link, plus a manual code for bookings you place yourself."
    };
  }

  if (has("catalogue", "catalog", "which operators", "what boats", "inventory")) {
    return {
      reply:
        "Vetted liveaboards and dive operators across Komodo and Raja Ampat - from accessible Explorer boats up to flagship phinisi. Every one screened for safety, sustainability, and fair crew pay, so nothing in there embarrasses you in front of a client. A taste is below - want me to narrow by destination or budget?",
      showCatalog: true
    };
  }

  if (has("founding", "terms", "lock")) {
    return {
      reply:
        "Founding partners lock their commission terms before we scale, get a real say in which operators join the catalogue, and first pick of group-trip space. Small cohort, on purpose. Want in? Company, market, and best email - that's all I need."
    };
  }

  if (has("claim", "link")) {
    return {
      reply:
        "If the team's already reached out, you'll have a personal link - it lands on a page pre-built for your business, one click to claim, no password. No link yet? Give me your company, market, and best email - or write partners@bluepass.co - and we'll mint one."
    };
  }

  if (has("book for a client", "book a trip for", "on behalf", "book now", "dates are set")) {
    return {
      reply:
        "Let's do it - treat it like any trip brief, credited to you. Where are they headed, Komodo or Raja Ampat? Then dates and group size, and I'll line up the right boat. The team makes sure the booking's attributed to your outfit."
    };
  }

  if (input.pitched) {
    return {
      reply:
        "Whatever's most useful - commissions, the catalogue, founding terms, or a live client brief. Or skip ahead: company, market, and best email, and the team sends your claim link."
    };
  }

  return {
    reply:
      "Then we built this for you. You get a tracked link and a catalogue of vetted Indonesian liveaboards; your client pays the operator's own rate - never marked up - and your commission comes out of the operator's side, not your client's pocket. Every booking funds ocean impact you can put your name on. What kind of outfit are you - shop, agency, creator?"
  };
}
