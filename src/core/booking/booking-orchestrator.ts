import { formatDateAndTime, formatDateForSentence, formatDatePhrase } from "./friendly-date";
import { bookingMemoryToContext, type BookingMemoryState } from "./booking-memory";
import {
  buildBluePassConservationReply,
  buildBluePassValueReply,
  isBluePassConservationQuestion,
  isBluePassValuePropQuestion
} from "@/core/bluepass/reply";
import { buildCardDeclineReply, containsCardShapedInput } from "@/core/security/card-detection";
import {
  analyzeTravellerBookingMessage,
  composeBookingBrainReply,
  type BookingBrainIntent,
  type BookingBrainResult
} from "./booking-brain";
import {
  composeBookingCaptureReply,
  evaluateBookingCapture,
  type BookingCaptureDetails
} from "./booking-capture";
import type { GenericBookingRouterLlmClient } from "@/core/llm/generic-booking-router";
import {
  beginExternalBooking,
  captureBookingDetails,
  markBookingReadyToConfirm,
  markExternalBookingConfirmed,
  markExternalBookingFailed,
  type BookingFlowState
} from "./booking-state-machine";
import { findBookingSmallTalkReply, isOfferQuestion, isQuestionShaped } from "./booking-small-talk";
import { extractGuestCount } from "@/core/conversation/guest-count";

const wantsTripPattern = /\b(?:i want|i'?d like|i would like|i'?m after|i'?m keen on|keen on|interested in|looking at|let'?s do|go with|i'?ll take)\b/i;
import { findOperatorKnowHowReply } from "./operator-know-how";
import { buildEmergencyReply, isEmergencyMessage } from "@/core/conversation/emergency";
import {
  acceptsPersonOffer,
  buildCallbackNumberThanksReply,
  buildHumanHandoffReply,
  givesCallbackNumber,
  isAskingForAPerson,
  PERSON_OFFER,
  type ConversationChannel
} from "@/core/conversation/human-handoff";
import { describePendingBookingStep } from "./booking-thread";
import { asksForSuggestion, pickProductForOccasion, summariseProductDescription } from "./product-insight";
import { matchPmsProduct } from "./product-matcher";
import { calculateBookingGrossAmountCents } from "./booking-pricing";
import {
  composeAssistantReply,
  type AssistantConversationMessage,
  type AssistantLlmClient,
  type AssistantReplySource,
  type AssistantTenantContext
} from "@/core/llm/assistant-reply-composer";
import type {
  PmsAdapter,
  PmsExtraOption,
  PmsExtraQuantity,
  PmsProduct,
  PmsTicketOption,
  PmsTicketQuantity,
  PmsTimeOption
} from "@/core/pms/types";
import {
  isPolicyShapedQuestion,
  matchesHandoffKeywords,
  matchKnowledgeEntry
} from "@/core/knowledge/knowledge-matcher";
import type { OperatorKnowledgePack } from "@/core/knowledge/types";

export type BookingOrchestratorAction =
  | "AVAILABILITY_CHECKED"
  | "MANUAL_INQUIRY_REQUIRED"
  | "NEEDS_PRODUCT_SELECTION"
  | "NEEDS_MORE_DETAILS"
  | "PRODUCT_RECOMMENDATION"
  | "HUMAN_HANDOFF"
  | "GENERAL_REPLY"
  | "BOOKING_DETAILS_REQUIRED"
  | "BOOKING_INQUIRY_READY"
  | "BOOKING_WRITE_DISABLED"
  | "BOOKING_READY_TO_CONFIRM"
  | "BOOKING_CONFIRMED"
  | "BOOKING_FAILED"
  | "PRODUCT_LINK"
  | "BOOKING_TIME_SELECTION_REQUIRED"
  | "BOOKING_CHECKOUT_READY"
  | "BOOKING_PAYMENT_REQUIRED"
  | "BOOKING_EXTRAS_SELECTION_REQUIRED"
  | "BOOKING_TICKET_SELECTION_REQUIRED";

// A real Rezdy (or other PMS) hold reserved for a BluePass-Stripe checkout, distinct from
// paymentHandoffUrl (the PMS's own payment link, e.g. RezdyPay). Carries an exact, computed price
// snapshot - the caller (generic-booking-turn.ts) uses this to create the actual Stripe Checkout
// Session, since this orchestrator has no Stripe/tenant/conversation context of its own.
export interface PmsCheckoutHold {
  externalBookingId: string;
  pmsProvider: PmsAdapter["provider"];
  productExternalId: string;
  productTitle: string;
  dateText: string;
  guests: number;
  travellerName: string;
  travellerEmail: string;
  travellerPhone: string | null;
  ticketQuantities: PmsTicketQuantity[];
  extraQuantities: PmsExtraQuantity[] | null;
  grossAmountCents: number;
  currency: string;
}

// kai-conversation-flow-notes.md item 9: the AU/Boattime equivalent of BluePassYachtCard - the
// structured shape a product-recommendation turn attaches so the widget can render tappable cards
// instead of a numbered text menu. Deliberately thinner than the BluePass card (no image, tier,
// region, cabins - Boattime products carry none of that, and the user decided not to source photos
// for this pass). `priceLabel` is null until a date is known; buildProductCards fills it in via a
// real per-product availability lookup once one is.
export interface BookingProductCard {
  slug: string;
  title: string;
  description: string;
  bookingMode: "MANUAL_INQUIRY" | "AUTO_BOOKING";
  productUrl?: string | null;
  priceLabel?: string | null;
  /** True once a date was actually given and this product's availability was checked for it (whether
   * or not it had a session that day) - lets the client tell "share your date" (dateChecked: false)
   * apart from "checked, but sold out/no session that day" (dateChecked: true, priceLabel: null), so
   * a traveller who already gave a date is never told to give it again. */
  dateChecked?: boolean;
}

export interface BookingOrchestratorResult {
  action: BookingOrchestratorAction;
  reply: string;
  replySource: AssistantReplySource;
  inquiryDraft?: BookingCaptureDetails | null;
  bookingStatePatch?: BookingFlowState | null;
  paymentHandoffUrl?: string | null;
  /** True when paymentHandoffUrl is the operator's own Rezdy booking page, where the traveller pays. */
  rezdyHandoff?: boolean;
  pmsCheckoutHold?: PmsCheckoutHold | null;
  productCards?: BookingProductCard[] | null;
  /** ISO yyyy-mm-dd dates, present only alongside an AVAILABILITY_CHECKED "not available" reply,
   * when the PMS adapter can search a date range (see PmsAdapter.findAvailableDates). Lets the
   * traveller pick a real open date instead of asking "what date do you have?" into the same
   * memorized-date re-check that just failed. */
  dateOptions?: string[] | null;
  /** Present only alongside a BOOKING_TIME_SELECTION_REQUIRED reply - see the wrapper around
   * handleTravellerBookingMessageInner for how these three are attached. */
  timeOptions?: PmsTimeOption[] | null;
  /** Present only alongside a BOOKING_TICKET_SELECTION_REQUIRED reply. */
  ticketOptions?: PmsTicketOption[] | null;
  /** Present only alongside a BOOKING_EXTRAS_SELECTION_REQUIRED reply. */
  extraOptions?: PmsExtraOption[] | null;
  /** A web visitor's WhatsApp number, left for the person the team is sending. */
  callbackNumber?: string | null;
}

export interface HandleTravellerBookingMessageInput {
  message: string;
  priorTravellerMessages?: string[];
  conversationHistory?: AssistantConversationMessage[];
  bookingMemory?: BookingMemoryState | null;
  pmsAdapter: PmsAdapter;
  bookingWriteEnabled?: boolean;
  allowUnpaidExternalBooking?: boolean;
  /** Tenant-scoped: reserve via the PMS then hand off to BluePass's own Stripe Checkout instead of
   * the PMS's own payment link (see PmsCheckoutHold). Only meaningful when the PMS adapter
   * implements confirmBooking. */
  bluePassStripeCheckoutEnabled?: boolean;
  /** Tenant-scoped: do not reserve a hold or charge through BluePass. Send the traveller to the
   * operator's own Rezdy booking page (with the chosen time selected when known) to pay there. */
  rezdyCheckoutHandoff?: {
    buildUrl: (args: {
      productExternalId: string | null;
      productUrl: string | null;
      dateText: string | null;
      timeOptions: PmsTimeOption[] | null;
    }) => string | null;
  } | null;
  llmClient?: AssistantLlmClient | null;
  routerClient?: GenericBookingRouterLlmClient | null;
  tenantContext?: AssistantTenantContext | null;
  /** Operator-authored answers (policies, logistics, FAQs). Loaded per tenant. */
  knowledgePack?: OperatorKnowledgePack | null;
  /** WhatsApp already has the traveller's number, so a handoff to a person never asks for it. */
  channel?: ConversationChannel;
  /** Reference clock for date parsing (resolveDefaultYear in booking-brain.ts) - defaults to the
   * real current time. Tests pin this so hardcoded expected dates stay deterministic regardless of
   * the actual wall-clock date the suite runs on. */
  now?: Date;
}

// kai-conversation-flow-notes.md item 12: the single source of price formatting for this whole
// file - one currency symbol, one figure, whole dollars, every time. Replaces the old formatPrice,
// which produced "AUD 159.00" and, combined with raw PMS ticket labels that sometimes already embed
// their own price, was how a traveller ended up seeing "$159.00 - AUD 159.00" for the same option.
export function formatCurrencyAmount(currency: string, unitPriceCents: number) {
  const symbol = currency === "AUD" ? "A$" : currency === "USD" ? "US$" : `${currency} `;
  return `${symbol}${Math.round(unitPriceCents / 100)}`;
}

function formatList(values: string[]) {
  if (values.length <= 1) return values[0] ?? "";

  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

function formatNumberedList(values: string[]) {
  return values.map((value, index) => `${index + 1}. ${value}`).join("\n");
}

async function composeReplyResult(input: {
  action: BookingOrchestratorAction;
  deterministicReply: string;
  requiredFacts?: string[];
  llmClient?: AssistantLlmClient | null;
  tenantContext?: AssistantTenantContext | null;
  latestUserMessage?: string | null;
  conversationHistory?: AssistantConversationMessage[];
  bookingStatePatch?: BookingFlowState | null;
}): Promise<BookingOrchestratorResult> {
  const composed = await composeAssistantReply({
    deterministicReply: input.deterministicReply,
    requiredFacts: input.requiredFacts,
    tenantContext: input.tenantContext,
    llmClient: input.llmClient,
    latestUserMessage: input.latestUserMessage,
    conversationHistory: input.conversationHistory
  });

  return {
    action: input.action,
    reply: composed.reply,
    replySource: composed.source,
    ...(input.bookingStatePatch !== undefined ? { bookingStatePatch: input.bookingStatePatch } : {})
  };
}

async function resolveGenericBookingRouterDecision(input: {
  routerClient: GenericBookingRouterLlmClient | null;
  tenantName: string;
  pmsProvider: string;
  latestMessage: string;
  priorTravellerMessages: string[];
  productTitles: string[];
  knownProductHint: string | null;
  knownDateText: string | null;
  knownGuests: number | null;
  missingSlots: string[];
}): Promise<BookingBrainIntent | null> {
  if (!input.routerClient) return null;

  try {
    const decision = await input.routerClient.route({
      tenantName: input.tenantName,
      pmsProvider: input.pmsProvider,
      latestMessage: input.latestMessage,
      priorTravellerMessages: input.priorTravellerMessages,
      productTitles: input.productTitles,
      knownProductHint: input.knownProductHint,
      knownDateText: input.knownDateText,
      knownGuests: input.knownGuests,
      missingSlots: input.missingSlots
    });
    return decision.intent;
  } catch (error) {
    console.error("generic_booking_router.llm_call_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

// Trivially-matched intents skip the LLM call entirely: a cleanly slotted availability/booking
// check or a specifically-named product is trusted outright (mirrors BluePass's high-confidence
// fallback actions). GENERAL_QUESTION (the cascade's own catch-all) and HUMAN_HANDOFF (whose regex
// still collides with bare guest-count phrasing, e.g. "2 person") always escalate.
export function shouldEscalateGenericBookingRouterToLlm(input: { regexResult: BookingBrainResult }): boolean {
  const { intent, slots } = input.regexResult;

  if (intent === "GENERAL_QUESTION" || intent === "HUMAN_HANDOFF") return true;
  if (intent === "PRODUCT_RECOMMENDATION") return !slots.productHint;

  return !(slots.productHint && slots.dateText && slots.guests);
}

// The only LLM verdict with a real side effect beyond reply text: BOOKING_INQUIRY is the one
// intent that skips the CHECK_AVAILABILITY capture-suppression guard below and, with
// bookingWriteEnabled on, can reach an unattended PMS booking write. Never trust it from the LLM
// alone - only when the deterministic cascade independently agrees. Every other intent (including
// a hallucinated CHECK_AVAILABILITY, which only ever makes capture more conservative) is safe to
// trust, since availability/price stay deterministic and requiredFacts still guards the polish step.
export function resolveFinalGenericBookingIntent(input: {
  llmIntent: BookingBrainIntent | null;
  regexResult: BookingBrainResult;
}): BookingBrainIntent {
  const { llmIntent, regexResult } = input;
  if (!llmIntent) return regexResult.intent;

  if (llmIntent === "BOOKING_INQUIRY" && regexResult.intent !== "BOOKING_INQUIRY") {
    return regexResult.intent;
  }

  return llmIntent;
}

function formatProductOptionsList(products: PmsProduct[]) {
  return formatNumberedList(
    products.map((product) =>
      `${product.title} - ${product.bookingMode === "AUTO_BOOKING" ? "live availability" : "operator confirmation required"}`
    )
  );
}

// kai-conversation-flow-notes.md item 9: builds the structured card list attached alongside
// formatRecommendationReply's text (BookingOrchestratorResult.productCards), so the widget can render
// tappable cards instead of a numbered menu. Without a date, cards ship price-less (the widget shows
// a "share your date for pricing" prompt); once a date is known, this calls the PMS's existing
// getAvailability once per product to get a real price - no PMS/adapter changes needed, this method
// already exists and is already called elsewhere in this file, just not this early. Capped at 8
// products since nothing upstream limits the product list size and this issues one live PMS call per
// card.
const PRODUCT_CARD_LIMIT = 8;

export async function buildProductCards(input: {
  products: PmsProduct[];
  dateText: string | null;
  guests: number | null;
  pmsAdapter: PmsAdapter;
  /** kai-conversation-flow-notes.md item 10, AUD dollars (Boattime is AUD-only). Sorts cards that fit
   * ahead of ones that don't, rather than hard-filtering - never produces an empty card set just
   * because nothing fits. */
  budgetAud?: number | null;
}): Promise<BookingProductCard[]> {
  const products = input.products.slice(0, PRODUCT_CARD_LIMIT);
  const base = (product: PmsProduct): BookingProductCard & { unitPriceCents: number | null } => ({
    slug: product.externalProductId,
    title: product.title,
    description: product.description,
    bookingMode: product.bookingMode,
    productUrl: product.productUrl ?? null,
    priceLabel: null,
    unitPriceCents: null
  });

  const cards = input.dateText
    ? await Promise.all(
        products.map(async (product) => {
          try {
            const availability = await input.pmsAdapter.getAvailability({
              productId: product.externalProductId,
              date: input.dateText!,
              guests: input.guests ?? 1
            });
            return availability.available
              ? {
                  ...base(product),
                  priceLabel: formatCurrencyAmount(availability.currency, availability.unitPriceCents),
                  unitPriceCents: availability.unitPriceCents,
                  dateChecked: true
                }
              : { ...base(product), dateChecked: true };
          } catch {
            return base(product);
          }
        })
      )
    : products.map(base);

  if (!input.budgetAud) {
    return cards.map(({ unitPriceCents: _unitPriceCents, ...card }) => card);
  }

  const budgetCents = input.budgetAud * 100;
  return cards
    .map((card, index) => ({ card, index, fits: card.unitPriceCents !== null && card.unitPriceCents <= budgetCents }))
    .sort((a, b) => Number(b.fits) - Number(a.fits) || a.index - b.index)
    .map(({ card: { unitPriceCents: _unitPriceCents, ...card } }) => card);
}

// Only called from a gated context (product+date already known, guest count specifically the thing
// being asked for, nothing else parsed from this message) - never treats an arbitrary bare number
// as a guest count, since the same shape means "pick option 2" elsewhere in this file.
function parseBareGuestCount(message: string) {
  const match = message.trim().match(/^(\d{1,2})(?:\s*(?:guests?|people|pax|of us|adults?))?$/i);
  if (!match) return null;

  const guests = Number(match[1]);
  return guests >= 1 && guests <= 20 ? guests : null;
}

function parseNumberedProductSelection(message: string) {
  const match = message
    .trim()
    .toLowerCase()
    .match(/^(?:(?:option|choice|number|no)\s*)?#?\s*(\d{1,2})(?:\s*(?:please|pls|thanks|thank you))?$/);

  return match ? Number(match[1]) : null;
}

function recentAssistantOfferedProductList(
  history: AssistantConversationMessage[] | undefined,
  products: PmsProduct[]
) {
  const lastAssistant = [...(history ?? [])].reverse().find((message) => message.role === "assistant");
  if (!lastAssistant) return false;

  const lowerContent = lastAssistant.content.toLowerCase();
  const productMentions = products.filter((product) => lowerContent.includes(product.title.toLowerCase())).length;

  return productMentions >= 2 && /\b(you can choose from|available options|which one sounds|which tour)\b/i.test(lastAssistant.content);
}

// Unlike recentAssistantOfferedProductList (which only looks at the very last assistant turn, for
// deciding whether a numbered reply like "1" refers to it), this scans the whole conversation so a
// decline reply (buildScopeDeclineReply) - which doesn't itself mention any product - doesn't reset
// "have we already shown this list" back to false on the very next turn, flipping back to re-showing
// the full list instead of continuing to offer email capture.
function productListWasEverShown(history: AssistantConversationMessage[] | undefined, products: PmsProduct[]) {
  return (history ?? []).some((message) => {
    if (message.role !== "assistant") return false;
    const lowerContent = message.content.toLowerCase();
    const productMentions = products.filter((product) => lowerContent.includes(product.title.toLowerCase())).length;
    return productMentions >= 2 && /\b(you can choose from|available options|which one sounds|which tour)\b/i.test(message.content);
  });
}

function selectedProductFromRecentList(input: {
  message: string;
  products: PmsProduct[];
  history?: AssistantConversationMessage[];
}) {
  const selectedNumber = parseNumberedProductSelection(input.message);
  if (!selectedNumber || !recentAssistantOfferedProductList(input.history, input.products)) {
    return null;
  }

  return input.products[selectedNumber - 1] ?? null;
}

// Strips both wrapping quote characters and a trailing embedded price/currency segment some raw PMS
// ticket labels already carry (e.g. an operator-configured "Adult - $159.00") - without this, that
// embedded price plus this file's own appended price doubled up into things like
// "Adult - $159.00 - AUD 159.00" for the same ticket option.
function formatTicketLabelForReply(label: string) {
  return label.replace(/^"+\s*/, "").replace(/\s*"+$/g, "");
}

// Only for the options-LIST display (formatTicketOptionsList/formatExtraOptionsList), which appends
// its own formatted price right after the label - stripping the label's own embedded price here
// avoids the label's price and the appended price doubling up (e.g. "Adult - $159.00 - AUD 159.00").
// formatTicketQuantities/formatExtraQuantities (confirming an already-picked option, no price
// appended alongside) must NOT strip this - that price is the only place it's shown there.
// "1 x Sparkling for 2": an example built from this operator's real first option, so Kai never
// suggests something they don't sell.
function optionExample(options: Array<{ label: string }>) {
  return `1 x ${stripEmbeddedPriceFromLabel(options[0]?.label ?? "")}`;
}

function stripEmbeddedPriceFromLabel(label: string) {
  return formatTicketLabelForReply(label)
    .replace(/\s*(?:for|at)?\s*[-–]?\s*(?:AUD|USD|\$)\s*[\d,]+(?:\.\d{2})?\s*$/i, "")
    .trim();
}

// The currency a remembered set of options is priced in. Adapters that know it (the native booking
// system) stamp it on each option; the Rezdy adapters do not, and every Rezdy tenant is Australian,
// so the fallback is AUD, which is what this flow always assumed.
function optionsCurrency(...lists: (ReadonlyArray<{ currency?: string }> | null | undefined)[]) {
  for (const list of lists) {
    const found = list?.find((option) => option.currency)?.currency;
    if (found) return found;
  }
  return "AUD";
}

function formatTicketOptionsList(options: PmsTicketOption[], currency: string) {
  return formatNumberedList(
    options.map(
      (option) =>
        `${stripEmbeddedPriceFromLabel(option.label)} - ${formatCurrencyAmount(currency, option.unitPriceCents)}`
    )
  );
}

// "x" between quantity and label, not just a space: a ticket type named "2 people" (a package
// size, not a per-unit count) plus a quantity of 2 read as "2 2 people" - reported live on
// boattimeyachtcharters.com (2026-08-23). Matches the "1 x 2 people" phrasing the ticket-option
// prompt itself already suggests (see the "Which ticket option" reply above), so the confirmation
// echo now reads the same way the traveller was told to answer.
function formatTicketQuantities(quantities: PmsTicketQuantity[]) {
  return formatList(quantities.map((ticket) => `${ticket.quantity} x ${formatTicketLabelForReply(ticket.optionLabel)}`));
}

function formatExtraOptionsList(options: PmsExtraOption[], currency: string) {
  return formatNumberedList(
    options.map(
      (option) =>
        `${stripEmbeddedPriceFromLabel(option.label)} - ${formatCurrencyAmount(currency, option.unitPriceCents)}`
    )
  );
}

function formatExtraQuantities(quantities: PmsExtraQuantity[]) {
  if (quantities.length === 0) return "no extras";

  return formatList(quantities.map((extra) => `${extra.quantity} x ${formatTicketLabelForReply(extra.optionLabel)}`));
}

function formatTimeOptionsList(options: PmsTimeOption[]) {
  return formatNumberedList(
    options.map((option) => `${option.label} - ${option.remaining} spot${option.remaining === 1 ? "" : "s"}`)
  );
}

async function createPendingPaymentOrder(input: {
  pmsAdapter: PmsAdapter;
  state: BookingFlowState;
}) {
  if (!input.state.productExternalId || !input.state.dateText || !input.state.guests) return null;
  if (!input.state.travellerName || !input.state.travellerEmail) return null;

  const booking = await input.pmsAdapter.createBooking({
    productId: input.state.productExternalId,
    date: input.state.dateText,
    guests: input.state.guests,
    travellerName: input.state.travellerName,
    travellerEmail: input.state.travellerEmail,
    travellerPhone: input.state.travellerPhone,
    ticketQuantities: input.state.ticketQuantities ?? null,
    extraQuantities: input.state.extraQuantities ?? null,
    confirmationMode: "PAYMENT_HOLD"
  });

  return booking.status === "FAILED" ? null : booking;
}

function normalizeTicketText(value: string) {
  return value
    .toLowerCase()
    .replace(/\baud\b/g, " ")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAdultTicket(label: string) {
  return /\badult\b/i.test(label);
}

function isChildTicket(label: string) {
  return /\bchild\b|\bchildren\b|\bkid\b/i.test(label);
}

function isInfantTicket(label: string) {
  return /\binfant\b|\bbaby\b|\bunder\s*3\b/i.test(label);
}

function isFamilyTicket(label: string) {
  return /\bfamily\b/i.test(label);
}

function isTwoPersonTicket(label: string) {
  return /\b2\s*(people|persons?)\b|\btwo\s*(people|persons?)\b/i.test(label);
}

function findTicketOption(options: PmsTicketOption[], matcher: (label: string) => boolean) {
  return options.find((option) => matcher(option.label));
}

function ticketOptionParticipantMultiplier(label: string) {
  if (isFamilyTicket(label)) return 4;
  if (isTwoPersonTicket(label)) return 2;
  return 1;
}

function findTicketOptionSelectedByLabel(message: string, options: PmsTicketOption[], guests?: number | null) {
  const normalizedMessage = normalizeTicketText(message);

  const selectedOption = options.find((option) => {
    const normalizedLabel = normalizeTicketText(option.label);
    const normalizedPrice = normalizeTicketText((option.unitPriceCents / 100).toFixed(2));

    return (
      normalizedLabel.length > 0 &&
      normalizedMessage.includes(normalizedLabel) &&
      (normalizedLabel.includes(normalizedPrice) || normalizedMessage.includes(normalizedPrice))
    );
  });

  if (!selectedOption) return null;

  const multiplier = ticketOptionParticipantMultiplier(selectedOption.label);
  const quantity = guests && guests % multiplier === 0 ? guests / multiplier : 1;

  return { optionLabel: selectedOption.label, quantity };
}

function ticketQuantityForGuests(optionLabel: string, guests?: number | null) {
  const multiplier = ticketOptionParticipantMultiplier(optionLabel);
  return guests && guests % multiplier === 0 ? guests / multiplier : 1;
}

function findTicketOptionSelectedByNumber(message: string, options: PmsTicketOption[], guests?: number | null) {
  const normalizedMessage = message.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  const ordinalWords: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10
  };
  const numberedSelection =
    normalizedMessage.match(/\b(?:option|choice|ticket|number|no)\s*#?\s*(\d{1,2})\b/) ??
    normalizedMessage.match(/#\s*(\d{1,2})\b/) ??
    // A bare number with nothing else ("2", "2 please") is a valid pick too, not just "option 2" -
    // confirmed live that a traveller who had just picked a product/operator by a bare number got
    // stuck: the very next bare-number reply here (meant to pick a ticket) matched nothing, silently
    // fell through the whole booking flow, and re-ran availability from scratch, showing the same
    // time-selection prompt forever regardless of what they typed next.
    normalizedMessage.match(/^(\d{1,2})(?:\s*(?:please|pls|thanks|thank you))?$/);
  let selectedIndex = numberedSelection ? Number(numberedSelection[1]) : null;

  if (!selectedIndex) {
    for (const [word, index] of Object.entries(ordinalWords)) {
      if (
        normalizedMessage.includes(`${word} option`) ||
        normalizedMessage.includes(`${word} choice`) ||
        normalizedMessage.includes(`${word} ticket`) ||
        normalizedMessage.includes(`option ${word}`) ||
        normalizedMessage.includes(`choice ${word}`) ||
        normalizedMessage.includes(`ticket ${word}`)
      ) {
        selectedIndex = index;
        break;
      }
    }
  }

  if (!selectedIndex) return null;

  const selectedOption = options[selectedIndex - 1];
  if (!selectedOption) return null;

  return {
    optionLabel: selectedOption.label,
    quantity: ticketQuantityForGuests(selectedOption.label, guests)
  };
}

function findTicketOptionsSelectedByNumber(message: string, options: PmsTicketOption[], guests?: number | null) {
  const normalizedMessage = message.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  const selectedIndexes: number[] = [];
  const addIndex = (rawIndex: string) => {
    const index = Number(rawIndex);
    if (!index || !options[index - 1] || selectedIndexes.includes(index)) return;
    selectedIndexes.push(index);
  };

  for (const match of normalizedMessage.matchAll(/\b(?:option|choice|ticket|number|no)\s*#?\s*(\d{1,2})\b/g)) {
    addIndex(match[1]);
  }

  for (const match of normalizedMessage.matchAll(/#\s*(\d{1,2})\b/g)) {
    addIndex(match[1]);
  }

  if (selectedIndexes.length <= 1) return [];

  const quantities = selectedIndexes.map((index) => ({
    optionLabel: options[index - 1].label,
    quantity: 1
  }));

  if (guests) {
    const selectedParticipants = quantities.reduce(
      (sum, quantity) => sum + ticketOptionParticipantMultiplier(quantity.optionLabel) * quantity.quantity,
      0
    );
    const remainingGuests = guests - selectedParticipants;
    const adjustableSingleTicket = quantities.find(
      (quantity) => ticketOptionParticipantMultiplier(quantity.optionLabel) === 1 && !isInfantTicket(quantity.optionLabel)
    );

    if (remainingGuests > 0 && adjustableSingleTicket) {
      adjustableSingleTicket.quantity += remainingGuests;
    }
  }

  return quantities;
}

function parseQuantityWord(value: string) {
  const normalized = value.toLowerCase();
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10
  };

  return Number(value) || words[normalized] || 0;
}

function readQuantityForWords(message: string, words: string[]) {
  const joinedWords = words.join("|");
  const quantityPattern = "\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten";
  const direct = message.match(new RegExp(`\\b(${quantityPattern})\\s*(?:${joinedWords})\\b`, "i"));
  if (direct) return parseQuantityWord(direct[1]);

  const reversed = message.match(new RegExp(`\\b(?:${joinedWords})\\s*(${quantityPattern})\\b`, "i"));
  return reversed ? parseQuantityWord(reversed[1]) : 0;
}

function parseTicketQuantities(message: string, options: PmsTicketOption[], guests?: number | null) {
  const quantities: PmsTicketQuantity[] = [];
  const selectedByNumbers = findTicketOptionsSelectedByNumber(message, options, guests);

  if (selectedByNumbers.length > 0) {
    return selectedByNumbers;
  }

  const selectedByNumber = findTicketOptionSelectedByNumber(message, options, guests);

  if (selectedByNumber) {
    return [selectedByNumber];
  }

  const selectedByLabel = findTicketOptionSelectedByLabel(message, options, guests);

  if (selectedByLabel) {
    return [selectedByLabel];
  }

  const twoPerson = findTicketOption(options, isTwoPersonTicket);
  const adult = findTicketOption(options, isAdultTicket);
  const child = findTicketOption(options, isChildTicket);
  const infant = findTicketOption(options, isInfantTicket);
  const family = findTicketOption(options, isFamilyTicket);
  const twoPersonQuantity = readQuantityForWords(message, [
    "2\\s*people\\s*tickets?",
    "two\\s*people\\s*tickets?",
    "2\\s*person\\s*tickets?",
    "two\\s*person\\s*tickets?"
  ]);
  const adultQuantity = readQuantityForWords(message, ["adult", "adults"]);
  const childQuantity = readQuantityForWords(message, ["child", "children", "kid", "kids"]);
  const infantQuantity = readQuantityForWords(message, ["infant", "infants", "baby", "babies"]);
  const familyQuantity = readQuantityForWords(message, ["family", "families"]);

  if (twoPerson && twoPersonQuantity > 0) quantities.push({ optionLabel: twoPerson.label, quantity: twoPersonQuantity });
  if (adult && adultQuantity > 0) quantities.push({ optionLabel: adult.label, quantity: adultQuantity });
  if (child && childQuantity > 0) quantities.push({ optionLabel: child.label, quantity: childQuantity });
  if (infant && infantQuantity > 0) quantities.push({ optionLabel: infant.label, quantity: infantQuantity });
  if (family && familyQuantity > 0) quantities.push({ optionLabel: family.label, quantity: familyQuantity });

  return quantities;
}

function isNoExtrasMessage(message: string) {
  return /\b(no extras?|skip extras?|nothing else|none|no thanks|no thank you)\b/i.test(message);
}

function findExtraOptionSelectedByNumber(message: string, options: PmsExtraOption[]) {
  const normalizedMessage = message.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  const numberedSelection =
    normalizedMessage.match(/\b(?:option|choice|extra|number|no)\s*#?\s*(\d{1,2})\b/) ??
    normalizedMessage.match(/#\s*(\d{1,2})\b/) ??
    // Same bare-number gap as findTicketOptionSelectedByNumber above, fixed for the same reason: a
    // traveller shouldn't need to say "option 1" here when a bare "1" already worked for picking a
    // product/ticket earlier in the same conversation.
    normalizedMessage.match(/^(\d{1,2})(?:\s*(?:please|pls|thanks|thank you))?$/);

  if (!numberedSelection) return null;

  const selectedOption = options[Number(numberedSelection[1]) - 1];
  return selectedOption ? { optionLabel: selectedOption.label, quantity: 1 } : null;
}

function parseExtraQuantities(message: string, options: PmsExtraOption[]) {
  if (isNoExtrasMessage(message)) return [] satisfies PmsExtraQuantity[];

  const selectedByNumber = findExtraOptionSelectedByNumber(message, options);
  if (selectedByNumber) return [selectedByNumber];

  const normalizedMessage = normalizeTicketText(message);
  const matchedOption = options.find((option) => {
    const normalizedLabel = normalizeTicketText(option.label);
    const labelWords = normalizedLabel.split(" ").filter(Boolean);
    const shortLabel = labelWords.slice(0, Math.min(2, labelWords.length)).join(" ");

    return (
      (normalizedLabel.length > 0 && normalizedMessage.includes(normalizedLabel)) ||
      (shortLabel.length > 0 && normalizedMessage.includes(shortLabel))
    );
  });

  if (!matchedOption) return null;

  const quantity =
    readQuantityForWords(message, [matchedOption.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")]) ||
    Number(message.match(/\b(\d{1,2})\s*x\b/i)?.[1]) ||
    1;

  return [{ optionLabel: matchedOption.label, quantity }];
}

function ticketParticipantCount(quantities: PmsTicketQuantity[]) {
  return quantities.reduce((total, ticket) => {
    const multiplier = ticketOptionParticipantMultiplier(ticket.optionLabel);
    return total + ticket.quantity * multiplier;
  }, 0);
}

// Reported live (2026-08-23): a traveller asked "what date available for riverfire 2026?" and then
// "what date that you have?" instead of naming one - composeMissingDetailsReply below is built
// purely from slot state (product/guests), never from the message itself, so both turns got the
// exact same "What date works for you?" prompt back verbatim. That reads as a stuck loop even
// though guests had genuinely been captured in between.
//
// Originally this only bought an honest "I can't browse dates" admission, since getAvailability
// only ever checks one specific date at a time - PmsAdapter.findAvailableDates (Rezdy-backed
// tenants only) changed that, and the "date"/"guests" missing-slots branch above now uses this same
// pattern to show a real calendar instead. The plain-text fallback below still matters for every
// other PMS, where there is still no calendar to build.
//
// Exported so that calendar branch can reuse the exact question shape this fallback text answers -
// two different regexes for "is the traveller asking to browse dates" would drift out of sync.
export const OPEN_DATE_QUESTION_PATTERN =
  /\b(what dates?|which dates?|what days?|which days?|when are you|when can|when do you|any dates?)\b/i;

function composeMissingDetailsReply(input: {
  missingSlots: ("product" | "date" | "guests")[];
  productTitle: string | null;
  dateText: string | null;
  guests: number | null;
  message?: string | null;
}) {
  if (input.missingSlots.length === 1 && input.missingSlots[0] === "guests" && input.productTitle && input.dateText) {
    return `Nice, ${input.productTitle} ${formatDatePhrase(input.dateText)}. How many of you are going?`;
  }

  if (input.missingSlots.length === 1 && input.missingSlots[0] === "date" && input.productTitle && input.guests) {
    const guestPhrase = `${input.guests} guest${input.guests === 1 ? "" : "s"}`;

    if (input.message && OPEN_DATE_QUESTION_PATTERN.test(input.message)) {
      return `I can only check one date at a time for ${input.productTitle}, so I can't show you a calendar just yet. Got a date in mind for ${guestPhrase}? I'll check it straight away.`;
    }

    return `Nice, ${input.productTitle} for ${guestPhrase}. What date suits you?`;
  }

  const slotWords = { product: "which trip", date: "the date", guests: "how many of you" } as const;

  return `Happy to check. Just tell me ${formatList(input.missingSlots.map((slot) => slotWords[slot]))}, and I'll see what's free.`;
}

// kai-conversation-flow-notes.md-style finding, caught live: when no date is known yet, the cards
// under this list say "Share your date for pricing" - but the old closing line ("Which one sounds
// closest to what you want?") never told the traveller a date was still needed, so the two read as
// contradictory: "choose one" next to "we don't have enough info to price this yet." Naming the next
// step explicitly closes that gap instead of leaving it to be inferred from the cards alone.
export function formatRecommendationReply(products: PmsProduct[], dateText: string | null) {
  const datePrefix = dateText ? `For ${formatDateForSentence(dateText)}, ` : "";
  const firstWord = dateText ? "you" : "You";
  const closing = dateText
    ? "Which one sounds closest to what you're after?"
    : "Which one sounds closest to what you're after? Tell me your date too and I'll check the price.";

  return `${datePrefix}${firstWord} can choose from:\n${formatProductOptionsList(products)}\n\n${closing}`;
}

// Anything in a mid-booking message that could be the step Kai is waiting on: a time, tickets, extras,
// contact details, a date or a headcount, or words about any of them.
function mightBeBookingStepAnswer(message: string, memory: BookingMemoryState | null | undefined) {
  const analysis = analyzeTravellerBookingMessage(message);
  if (analysis.slots.dateText || analysis.slots.guests || extractEmailAddress(message) || /\d{6,}|\d{3,4}\s?\d{3}\s?\d{3}/.test(message)) {
    return true;
  }
  if (memory?.timeOptions?.length && parseSelectedTimeOption(message, memory.timeOptions)) return true;
  if (memory?.ticketOptions?.length && parseTicketQuantities(message, memory.ticketOptions, memory.guests).length > 0) return true;
  // "No extras" parses to an empty list, which is still an answer; null means nothing matched.
  if (memory?.extraOptions?.length && parseExtraQuantities(message, memory.extraOptions) !== null) return true;

  return /\b(?:time|times|am|pm|morning|afternoon|arvo|evening|earlier|later|tickets?|adults?|child|children|kids?|concession|extras?|add|name|email|phone|number|book|booking|date|day|tomorrow|today|week|guests?|people|us|change|instead|cancel)\b/i.test(
    message
  );
}

// Trips the operator confirms by hand: say what happens next in plain words, and never imply it's booked.
function composeManualInquiryReply(productTitle: string) {
  return `The crew confirm ${productTitle} bookings themselves, so I can't lock it in on the spot. I can take your details and pass the request on, and nothing's booked until they confirm.`;
}

// The traveller named a trip this operator doesn't run ("Komodo Day Trip" on a Gold Coast charter):
// say so plainly before offering what they do have, rather than quietly changing the subject.
function notOfferedPrefix(requestedProduct: string | null | undefined, products: PmsProduct[]) {
  if (!requestedProduct) return "";
  const requested = requestedProduct.toLowerCase();
  if (products.some((product) => product.title.toLowerCase().includes(requested) || requested.includes(product.title.toLowerCase()))) {
    return "";
  }

  return `I don't have ${/^[aeiou]/i.test(requestedProduct) ? "an" : "a"} ${requestedProduct} here, sorry. `;
}

// kai-conversation-flow-notes.md's proposed copy for the "we don't have that" path - honest,
// short, and converts a dead end into a lead instead of a silently repeated wrong-fit list.
export function buildScopeDeclineReply() {
  return "None of these quite fit what you're after, and I'd rather not force it. Want to leave your email so the team can follow up when something does?";
}

export function extractEmailAddress(message: string) {
  return message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
}

function lowerFirstLetter(value: string) {
  return value.length === 0 ? value : value[0].toLowerCase() + value.slice(1);
}

function formatProductInfoReply(product: PmsProduct) {
  // Booking systems hand over anything from "Sunset cruise" to pages of HTML: a short phrase reads
  // as "X is a sunset cruise", a full sentence is quoted as the operator wrote it, and anything
  // longer is left to the product page.
  const summary = summariseProductDescription(product.description);
  const isPhrase = Boolean(summary && !/[.!?]$/.test(summary) && summary.split(/\s+/).length <= 8);
  const intro = !summary
    ? `${product.title} is one I can book for you.`
    : isPhrase
      ? `${product.title} is ${/^[aeiou]/i.test(summary!) ? "an" : "a"} ${lowerFirstLetter(summary!)}.`
      : `Here's ${product.title} in a nutshell: ${summary}`;
  const linkSentence = product.productUrl ? ` You can see the full details here: ${product.productUrl}.` : "";

  return `${intro}${linkSentence} If it looks good, tell me your date and how many of you, and I'll check it.`;
}

// Kai's pick for who's travelling, with the reason taken from the operator's own trip details.
function composeProductPickReply(pick: NonNullable<ReturnType<typeof pickProductForOccasion>>) {
  const agesNote = pick.isFamily ? " The crew can confirm it suits your kids' ages." : "";

  return `For ${pick.occasion}, I'd go with the ${pick.product.title}: ${pick.reason}.${agesNote} Tell me your date and I'll check it, or I can run you through the others.`;
}



function formatAvailabilityDatePhrase(dateText: string | null) {
  return dateText?.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):\d{2}$/)
    ? formatDateAndTime(dateText)
    : formatDatePhrase(dateText);
}

function selectedTimeOption(dateText: string | null | undefined, options: PmsTimeOption[]) {
  return options.find((option) => option.startTimeLocal === dateText) ?? null;
}

function normalizeTimeSelectionText(value: string) {
  return value.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
}

function timeSelectionAliases(label: string) {
  const normalized = normalizeTimeSelectionText(label);
  const compact = normalized.replace(/\s+/g, "");
  const aliases = new Set([normalized, compact, compact.replace(":", "")]);
  const timeMatch = compact.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm)$/);

  if (timeMatch) {
    const minutes = timeMatch[2] ?? "00";
    const period = timeMatch[3];
    const periodShort = period[0];

    aliases.add(`${timeMatch[1]}:${minutes}${period}`);
    aliases.add(`${timeMatch[1]}:${minutes} ${period}`);
    aliases.add(`${timeMatch[1]}${minutes}${period}`);
    aliases.add(`${timeMatch[1]}:${minutes}${periodShort}`);
    aliases.add(`${timeMatch[1]}:${minutes} ${periodShort}`);
    aliases.add(`${timeMatch[1]}${minutes}${periodShort}`);

    if (minutes === "00") {
      aliases.add(`${timeMatch[1]}${period}`);
      aliases.add(`${timeMatch[1]} ${period}`);
      aliases.add(`${timeMatch[1]}${periodShort}`);
      aliases.add(`${timeMatch[1]} ${periodShort}`);
    }
  }

  return [...aliases];
}

function parseClockFromOptionLabel(label: string) {
  const match = normalizeTimeSelectionText(label).match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (!match) return null;

  return {
    hour: Number(match[1]),
    minute: Number(match[2] ?? "00"),
    period: match[3]
  };
}

function findClockSelection(message: string, options: PmsTimeOption[]) {
  const normalizedMessage = normalizeTimeSelectionText(message);

  if (/\b(noon|midday)\b/.test(normalizedMessage)) {
    const noonOption = options.find((option) => {
      const optionClock = parseClockFromOptionLabel(option.label);
      return optionClock?.hour === 12 && optionClock.minute === 0 && optionClock.period === "pm";
    });

    if (noonOption) return noonOption;
  }

  const matches = [...normalizedMessage.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(a|am|p|pm)?\b/g)];

  for (const match of matches.reverse()) {
    const hour = Number(match[1]);
    const minute = Number(match[2] ?? "00");
    const period = match[3]?.length === 1 ? (match[3] === "a" ? "am" : "pm") : match[3] ?? null;
    const hasExplicitClockShape = Boolean(match[2] || period);

    if (!hasExplicitClockShape || hour < 1 || hour > 12 || minute > 59) continue;

    const matchedOption = options.find((option) => {
      const optionClock = parseClockFromOptionLabel(option.label);
      if (!optionClock) return false;

      if (optionClock.hour !== hour || optionClock.minute !== minute) return false;

      return period ? optionClock.period === period : true;
    });

    if (matchedOption) return matchedOption;
  }

  return null;
}

// The bare-number/ordinal-word fallback below is only safe when time is the ONLY thing being
// discussed (the original "which time works best?" prompt) - a bare "2" or "second" there
// unambiguously means time option 2. Once ticket selection is also in play, the same digit almost
// always refers to a TICKET option ("option 2 and option 5") instead, so callers checking for a
// time CORRECTION mid-ticket-selection must pass allowBareNumberFallback: false, or they will
// silently reinterpret a ticket choice as a time change and corrupt an already-confirmed time.
// The newest explicit clock time ("1:30", "9am", "noon") in the traveller's last few messages that
// matches one of the offered times. Bare numbers don't count here: "3" is more likely a headcount.
function findEarlierClockSelection(messages: string[], options: PmsTimeOption[]) {
  for (const message of [...messages].slice(-3).reverse()) {
    const match = findClockSelection(message, options);
    if (match) return match;
  }

  return null;
}

function declinesSuggestion(message: string) {
  return /\b(?:no|nah|nope|not that|another|different|other)\b/i.test(message);
}

// True when Kai's last message already listed every one of these options, so repeating the whole
// list again would read as a loop.
function optionsAlreadyShown(history: HandleTravellerBookingMessageInput["conversationHistory"], labels: string[]) {
  const lastAssistant = [...(history ?? [])].reverse().find((message) => message.role === "assistant");
  return Boolean(lastAssistant && labels.every((label) => lastAssistant.content.includes(label)));
}

function formatOrList(values: string[]) {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} or ${values.at(-1)}`;
}

function parseSelectedTimeOption(
  message: string,
  options: PmsTimeOption[],
  config: { allowBareNumberFallback?: boolean } = {}
) {
  const allowBareNumberFallback = config.allowBareNumberFallback ?? true;
  const normalizedMessage = normalizeTimeSelectionText(message);
  const compactMessage = normalizedMessage.replace(/\s+/g, "");
  const clockSelection = findClockSelection(message, options);

  if (clockSelection) {
    return clockSelection;
  }

  const matchedOption = options
    .map((option) => {
      const latestIndex = Math.max(
        ...timeSelectionAliases(option.label).map((alias) => {
          const normalizedAlias = normalizeTimeSelectionText(alias);
          const compactAlias = normalizedAlias.replace(/\s+/g, "");
          const spacedIndex = normalizedMessage.lastIndexOf(normalizedAlias);
          const compactIndex = compactMessage.lastIndexOf(compactAlias);

          return Math.max(spacedIndex, compactIndex);
        })
      );

      return { option, latestIndex };
    })
    .filter((item) => item.latestIndex >= 0)
    .sort((left, right) => right.latestIndex - left.latestIndex)[0]?.option;

  if (matchedOption) {
    return matchedOption;
  }

  if (!allowBareNumberFallback) {
    return null;
  }

  const ordinalWords: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5
  };

  const numberedSelection = normalizedMessage.match(/\b([1-5])\b/);
  if (numberedSelection) {
    return options[Number(numberedSelection[1]) - 1] ?? null;
  }

  for (const [word, index] of Object.entries(ordinalWords)) {
    if (normalizedMessage.includes(word)) {
      return options[index - 1] ?? null;
    }
  }

  return null;
}

function isBookingConfirmationMessage(message: string) {
  return /\b(yes|confirm|confirmed|book it|create (the )?booking|go ahead|proceed)\b/i.test(message);
}

function isProductLinkRequest(message: string) {
  return /\b(see it|see this|view it|view this|look first|see first|link|website|page|details?|more info|browse)\b/i.test(
    message
  );
}

function bookingMemoryToFlowState(memory: BookingMemoryState): BookingFlowState | null {
  if (
    !memory.productExternalId ||
    !memory.productTitle ||
    !memory.dateText ||
    !memory.guests ||
    !memory.travellerName ||
    !memory.travellerEmail
  ) {
    return null;
  }

  return {
    productExternalId: memory.productExternalId,
    productTitle: memory.productTitle,
    dateText: memory.dateText,
    guests: memory.guests,
    travellerName: memory.travellerName,
    travellerEmail: memory.travellerEmail,
    travellerPhone: memory.travellerPhone ?? "",
    bookingStatus: memory.bookingStatus ?? "DRAFT",
    confirmationSummary: memory.confirmationSummary ?? null,
    externalBookingId: memory.externalBookingId ?? null,
    externalProvider: (memory.externalProvider as BookingFlowState["externalProvider"]) ?? null,
    bookingError: memory.bookingError ?? null,
    ...(memory.timeOptions ? { timeOptions: memory.timeOptions } : {}),
    ...(memory.ticketOptions ? { ticketOptions: memory.ticketOptions } : {}),
    ...(memory.ticketQuantities ? { ticketQuantities: memory.ticketQuantities } : {}),
    ...(memory.extraOptions ? { extraOptions: memory.extraOptions } : {}),
    ...(memory.extraQuantities ? { extraQuantities: memory.extraQuantities } : {})
  };
}

function buildAvailabilityState(input: {
  product: PmsProduct;
  dateText: string | null;
  guests: number | null;
  timeOptions?: PmsTimeOption[] | null;
  ticketOptions?: PmsTicketOption[] | null;
  extraOptions?: PmsExtraOption[] | null;
}): BookingFlowState {
  return {
    productExternalId: input.product.externalProductId,
    productTitle: input.product.title,
    dateText: input.dateText,
    guests: input.guests,
    travellerName: null,
    travellerEmail: null,
    travellerPhone: null,
    bookingStatus: "AVAILABILITY_CHECKED",
    confirmationSummary: null,
    externalBookingId: null,
    externalProvider: null,
    bookingError: null,
    ...(input.timeOptions ? { timeOptions: input.timeOptions } : {}),
    ...(input.ticketOptions ? { ticketOptions: input.ticketOptions } : {}),
    ticketQuantities: null,
    ...(input.extraOptions && input.extraOptions.length > 0
      ? { extraOptions: input.extraOptions, extraQuantities: null }
      : {})
  };
}

function formatMissingContactSlots(slots: ("name" | "email" | "phone")[]) {
  const labels = slots.map((slot) => (slot === "phone" ? "phone number" : slot));
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;

  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function buildContactCollectionState(input: {
  memory: BookingMemoryState | null | undefined;
  capture: ReturnType<typeof evaluateBookingCapture>;
}): BookingFlowState {
  return {
    productExternalId: input.capture.details.productExternalId ?? input.memory?.productExternalId ?? null,
    productTitle: input.capture.details.productTitle ?? input.memory?.productTitle ?? null,
    dateText: input.capture.details.dateText ?? input.memory?.dateText ?? null,
    guests: input.capture.details.guests ?? input.memory?.guests ?? null,
    travellerName: input.capture.details.travellerName ?? input.memory?.travellerName ?? null,
    travellerEmail: input.capture.details.travellerEmail ?? input.memory?.travellerEmail ?? null,
    travellerPhone: input.capture.details.travellerPhone ?? input.memory?.travellerPhone ?? null,
    bookingStatus: input.memory?.bookingStatus ?? "AVAILABILITY_CHECKED",
    confirmationSummary: input.memory?.confirmationSummary ?? null,
    externalBookingId: input.memory?.externalBookingId ?? null,
    externalProvider: (input.memory?.externalProvider as BookingFlowState["externalProvider"]) ?? null,
    bookingError: input.memory?.bookingError ?? null,
    ...(input.memory?.timeOptions ? { timeOptions: input.memory.timeOptions } : {}),
    ...(input.memory?.ticketOptions ? { ticketOptions: input.memory.ticketOptions } : {}),
    ...(input.memory?.ticketQuantities ? { ticketQuantities: input.memory.ticketQuantities } : {}),
    ...(input.memory?.extraOptions ? { extraOptions: input.memory.extraOptions } : {}),
    ...(input.memory?.extraQuantities ? { extraQuantities: input.memory.extraQuantities } : {})
  };
}

function composeContactCollectionReply(capture: ReturnType<typeof evaluateBookingCapture>) {
  const missing = formatMissingContactSlots(capture.missingContactSlots);

  if (capture.details.travellerName) {
    const firstName = capture.details.travellerName.trim().split(/\s+/)[0];
    return `Thanks, ${firstName}. I just need your ${missing} to set up secure payment.`;
  }

  return `I just need your ${missing} to set up secure payment.`;
}

export async function handleTravellerBookingMessage(
  input: HandleTravellerBookingMessageInput
): Promise<BookingOrchestratorResult> {
  const result = await handleTravellerBookingMessageInner(input);

  // Surfaced as real tappable buttons in the widget (KaiChoiceOptions) instead of a plain numbered
  // list the traveller has to retype ("option 2" / "1 x 2 people") - one mistyped reply used to
  // send the whole exchange back through this same prompt. The reply text still lists them too, so
  // nothing that only reads `.reply` (WhatsApp, an LLM rewrite) breaks.
  //
  // Sourced from bookingStatePatch rather than threaded through every one of the SELECTION_REQUIRED
  // branches above individually - every one of them already populates bookingStatePatch faithfully
  // (it's how the next turn recovers the same options from bookingMemory), so this is one
  // derivation instead of repeating the same three lines at every return point above.
  if (result.action === "BOOKING_TIME_SELECTION_REQUIRED") {
    return { ...result, timeOptions: result.bookingStatePatch?.timeOptions ?? null };
  }
  if (result.action === "BOOKING_TICKET_SELECTION_REQUIRED") {
    return { ...result, ticketOptions: result.bookingStatePatch?.ticketOptions ?? null };
  }
  if (result.action === "BOOKING_EXTRAS_SELECTION_REQUIRED") {
    return { ...result, extraOptions: result.bookingStatePatch?.extraOptions ?? null };
  }

  return result;
}

async function handleTravellerBookingMessageInner(
  input: HandleTravellerBookingMessageInput
): Promise<BookingOrchestratorResult> {
  // kai-conversation-flow-notes.md finding #16 (compliance): checked before anything else -
  // classification, LLM calls, everything - so card-shaped input never has a chance to reach any of
  // those, and always gets an explicit, deterministic refusal instead of an LLM improvising one.
  if (containsCardShapedInput(input.message)) {
    return {
      action: "GENERAL_REPLY",
      reply: buildCardDeclineReply(),
      replySource: "DETERMINISTIC"
    };
  }

  let cachedProducts: PmsProduct[] | null = null;
  const listProducts = async () => {
    cachedProducts ??= await input.pmsAdapter.listProducts();
    return cachedProducts;
  };

  // Someone hurt or in danger comes before any booking logic, and is never handed to the AI.
  if (isEmergencyMessage(input.message)) {
    return { action: "GENERAL_REPLY", reply: buildEmergencyReply(), replySource: "DETERMINISTIC" };
  }

  // Asking for a person (or saying yes when Kai offered one) gets one: a person from the team jumps
  // into the chat as soon as possible. Kept word for word, never rewritten by the AI.
  const previousKaiMessage =
    [...(input.conversationHistory ?? [])].reverse().find((message) => message.role === "assistant")?.content ?? null;
  const callbackNumber = givesCallbackNumber(input.message, previousKaiMessage);
  if (callbackNumber) {
    return {
      action: "HUMAN_HANDOFF",
      reply: buildCallbackNumberThanksReply(callbackNumber),
      replySource: "DETERMINISTIC",
      callbackNumber
    };
  }

  if (isAskingForAPerson(input.message) || acceptsPersonOffer(input.message, previousKaiMessage)) {
    return {
      action: "HUMAN_HANDOFF",
      reply: buildHumanHandoffReply({ channel: input.channel ?? "web", nothingChanges: true }),
      replySource: "DETERMINISTIC"
    };
  }

  // "Are you a bot?" is never a booking step, so it gets its straight answer even mid-booking. Found by
  // running Kai's personality doc against production (2026-10-03): with a date already on the table it
  // came back as the product list, because the small-talk check sits far below the date handling.
  const botQuestion = findBookingSmallTalkReply(input.message, { tenantName: input.tenantContext?.tenantName });
  if (botQuestion?.kind === "AI_OR_HUMAN") {
    return { action: "GENERAL_REPLY", reply: botQuestion.reply, replySource: "DETERMINISTIC" };
  }

  if (
    input.bookingWriteEnabled === true &&
    input.bookingMemory?.bookingStatus === "READY_TO_CONFIRM" &&
    isBookingConfirmationMessage(input.message)
  ) {
    const readyState = bookingMemoryToFlowState(input.bookingMemory);

    if (!readyState) {
      return {
        action: "BOOKING_FAILED",
        reply: "I can't book this in just yet because some details are missing. Let's run through the date, group size and your contact details again.",
        replySource: "DETERMINISTIC"
      };
    }

    const pendingState = beginExternalBooking(readyState);

    if (input.allowUnpaidExternalBooking !== true) {
      const blockedState = {
        ...readyState,
        bookingError: "External booking blocked because payment has not been collected in Kai."
      };

      return {
        action: "BOOKING_WRITE_DISABLED",
        reply:
          "I've saved your booking request for the operator. Nothing has been paid yet, so I won't lock in the booking until payment is sorted, and they'll follow up with you on that.",
        replySource: "DETERMINISTIC",
        inquiryDraft: {
          productExternalId: readyState.productExternalId,
          productTitle: readyState.productTitle,
          dateText: readyState.dateText,
          guests: readyState.guests,
          travellerName: readyState.travellerName,
          travellerEmail: readyState.travellerEmail,
          travellerPhone: readyState.travellerPhone
        },
        bookingStatePatch: blockedState
      };
    }

    try {
      const booking = await input.pmsAdapter.createBooking({
        productId: pendingState.productExternalId!,
        date: pendingState.dateText!,
        guests: pendingState.guests!,
        travellerName: pendingState.travellerName!,
        travellerEmail: pendingState.travellerEmail!,
        travellerPhone: pendingState.travellerPhone,
        ticketQuantities: pendingState.ticketQuantities ?? null
      });

      if (booking.status === "FAILED") {
        const failedState = markExternalBookingFailed(pendingState, "PMS returned failed booking status.");

        return {
          action: "BOOKING_FAILED",
          reply:
            "I couldn't lock this in with the operator's booking system just now, so I've saved your request and passed it to the team to confirm. It's not booked yet.",
          replySource: "DETERMINISTIC",
          bookingStatePatch: failedState
        };
      }

      const confirmedState = markExternalBookingConfirmed(pendingState, {
        externalBookingId: booking.externalBookingId,
        externalProvider: booking.provider
      });

      return {
        action: "BOOKING_CONFIRMED",
        reply: `You're booked in: ${confirmedState.productTitle} ${formatDatePhrase(confirmedState.dateText)} for ${
          confirmedState.guests
        } guest${confirmedState.guests === 1 ? "" : "s"}, confirmation reference ${
          booking.externalBookingId
        }. I haven't taken any payment here, so the operator will sort that with you.`,
        replySource: "DETERMINISTIC",
        bookingStatePatch: confirmedState
      };
    } catch (error) {
      const failedState = markExternalBookingFailed(
        pendingState,
        error instanceof Error ? error.message : "PMS booking request failed."
      );

      return {
        action: "BOOKING_FAILED",
        reply:
          "I couldn't lock this in with the operator's booking system just now, so I've saved your request and passed it to the team to confirm. It's not booked yet.",
        replySource: "DETERMINISTIC",
        bookingStatePatch: failedState
      };
    }
  }

  const contextMessage = [
    bookingMemoryToContext(input.bookingMemory ?? null),
    ...(input.priorTravellerMessages ?? []),
    input.message
  ].join(" ");
  const currentMessageAnalysis = analyzeTravellerBookingMessage(input.message, input.now);
  const contextAnalysis = analyzeTravellerBookingMessage(contextMessage, input.now);
  const analysis =
    currentMessageAnalysis.intent === "GENERAL_QUESTION"
      ? contextAnalysis
      : currentMessageAnalysis;
  // kai-conversation-flow-notes.md finding #5: a bare "2" in reply to "how many guests?" fell
  // through every slot source (findGuests requires a unit word like "guests"/"adults") and re-asked
  // the same question. Only trusted as a guest count when product+date are already known and this
  // turn's own analysis found nothing else usable - i.e. Kai is specifically awaiting a guest-count
  // reply, not some other bare-number moment (a numbered-menu pick, a ticket-option choice, etc.).
  const bareGuestCountReply =
    input.bookingMemory?.productTitle &&
    input.bookingMemory?.dateText &&
    !input.bookingMemory?.guests &&
    currentMessageAnalysis.slots.guests === null &&
    !currentMessageAnalysis.slots.productHint &&
    !currentMessageAnalysis.slots.dateText
      ? parseBareGuestCount(input.message)
      : null;
  const effectiveSlots = {
    productHint: currentMessageAnalysis.slots.productHint ?? input.bookingMemory?.productTitle ?? contextAnalysis.slots.productHint ?? null,
    dateText: currentMessageAnalysis.slots.dateText ?? input.bookingMemory?.dateText ?? contextAnalysis.slots.dateText ?? null,
    guests: currentMessageAnalysis.slots.guests ?? bareGuestCountReply ?? input.bookingMemory?.guests ?? contextAnalysis.slots.guests ?? null
  };
  const missingSlots = [
    effectiveSlots.productHint ? null : "product",
    effectiveSlots.dateText ? null : "date",
    effectiveSlots.guests ? null : "guests"
  ].filter((slot): slot is "product" | "date" | "guests" => Boolean(slot));

  const shouldCallGenericBookingRouter = shouldEscalateGenericBookingRouterToLlm({ regexResult: analysis });
  console.log(shouldCallGenericBookingRouter ? "generic_booking_router.call_made" : "generic_booking_router.call_skipped", {
    regexIntent: analysis.intent,
    hasRouterClient: Boolean(input.routerClient)
  });
  const routerIntent = shouldCallGenericBookingRouter
    ? await resolveGenericBookingRouterDecision({
        routerClient: input.routerClient ?? null,
        tenantName: input.tenantContext?.tenantName ?? "this tenant",
        pmsProvider: input.tenantContext?.pmsProvider ?? "the configured PMS",
        latestMessage: input.message,
        priorTravellerMessages: input.priorTravellerMessages ?? [],
        productTitles: input.tenantContext?.productTitles ?? [],
        knownProductHint: effectiveSlots.productHint,
        knownDateText: effectiveSlots.dateText,
        knownGuests: effectiveSlots.guests,
        missingSlots
      })
    : null;
  const resolvedIntent = resolveFinalGenericBookingIntent({ llmIntent: routerIntent, regexResult: analysis });

  // kai-conversation-flow-notes.md, stop-the-line item A + finding #7: this path had zero grounding
  // for "why book through you" / "where does the 5% go" - the LLM was free to invent an answer (once:
  // "streamlined and centralized process..." with no operator's-rate/never-a-markup/5% facts at all).
  // Checked before any intent-specific branch (not just inside GENERAL_QUESTION) because a message
  // like "Why is booking through you better..." contains the word "booking" and the regex cascade in
  // booking-brain.ts classifies that as BOOKING_INQUIRY, not GENERAL_QUESTION - these are BluePass-wide
  // truths, not a per-operator policy or a booking intent, so they take priority over both.
  if (isBluePassConservationQuestion(input.message) || isBluePassValuePropQuestion(input.message)) {
    const deterministicReply = isBluePassConservationQuestion(input.message)
      ? buildBluePassConservationReply()
      : buildBluePassValueReply();
    return composeReplyResult({
      action: "GENERAL_REPLY",
      deterministicReply,
      requiredFacts: ["operator's side", "never added to your fare"],
      llmClient: input.llmClient,
      tenantContext: input.tenantContext,
      latestUserMessage: input.message,
      conversationHistory: input.conversationHistory
    });
  }

  // "Will I get seasick?" or "when's whale season?" mid-booking is still a question in its own right:
  // answer it before the booking context from earlier turns turns it into a booking step. A trip the
  // operator doesn't run is left to the honest "I don't have that" path further down.
  const pendingStep = describePendingBookingStep(input.bookingMemory);
  // Said in Kai's last message? Then saying it again straight away would read like a script.
  const lastKaiMessage = [...(input.conversationHistory ?? [])].reverse().find((message) => message.role === "assistant")?.content ?? "";
  const reminderJustSaid = Boolean(pendingStep && lastKaiMessage.includes(pendingStep));
  const answerKnowHow = async (productTitle: string | null) => {
    const knowHow = await findOperatorKnowHowReply({
      message: input.message,
      tenantName: input.tenantContext?.tenantName,
      productTitle,
      dateKnown: Boolean(currentMessageAnalysis.slots.dateText ?? input.bookingMemory?.dateText),
      loadCatalogue: listProducts
    });

    if (!knowHow) return null;

    // Mid-booking, the answer is followed by where the booking is up to, not a fresh "check a date?",
    // unless Kai only just said it.
    const standsAlone = knowHow.asksBack || knowHow.topic === "TIMES" || knowHow.topic === "PRICE";
    const reminder = standsAlone || reminderJustSaid ? null : pendingStep;
    const deterministicReply = reminder
      ? `${knowHow.answer} ${reminder}`
      : pendingStep && !standsAlone
        ? knowHow.answer
        : knowHow.reply;

    return composeReplyResult({
      action: "GENERAL_REPLY",
      deterministicReply,
      requiredFacts: [...(reminder ? [reminder] : []), ...(deterministicReply.includes(PERSON_OFFER) ? [PERSON_OFFER] : [])],
      llmClient: input.llmClient,
      tenantContext: input.tenantContext,
      latestUserMessage: input.message,
      conversationHistory: input.conversationHistory
    });
  };
  // "What's good for a couple?" gets a pick and a reason, when one trip clearly suits them best.
  const answerPick = async (requireAsk: boolean): Promise<BookingOrchestratorResult | null> => {
    if (requireAsk && !asksForSuggestion(input.message)) return null;

    const catalogue = await listProducts();
    const pick = pickProductForOccasion(input.message, catalogue);
    if (!pick) return null;

    return {
      action: "PRODUCT_RECOMMENDATION",
      reply: composeProductPickReply(pick),
      replySource: "DETERMINISTIC",
      productCards: await buildProductCards({
        products: [pick.product, ...catalogue.filter((product) => product !== pick.product)],
        dateText: currentMessageAnalysis.slots.dateText,
        guests: effectiveSlots.guests,
        pmsAdapter: input.pmsAdapter,
        budgetAud: currentMessageAnalysis.slots.budget
      })
    };
  };
  const namedHint = currentMessageAnalysis.slots.productHint;
  const namesTripNotOffered = namedHint
    ? Boolean(notOfferedPrefix(namedHint, await listProducts())) && matchPmsProduct(namedHint, await listProducts()).status !== "MATCHED"
    : false;

  if (currentMessageAnalysis.intent === "GENERAL_QUESTION" && !namesTripNotOffered) {
    const ownTermsReply = (await answerKnowHow(input.bookingMemory?.productTitle ?? null)) ?? (await answerPick(true));
    if (ownTermsReply) return ownTermsReply;

    // "Can I bring my dog?" while Kai is waiting on a time: an honest word, then back to the booking,
    // rather than a reply that ignores the question. Anything that could be the booking step itself
    // ("can we do 1:30?", "is it ok if I use my work email?") is left to the booking flow.
    if (pendingStep && isQuestionShaped(input.message) && !mightBeBookingStepAnswer(input.message, input.bookingMemory)) {
      const honestAnswer =
        "Good question. I don't want to give you a dud answer on that one, so I won't guess. Just ask if you'd like a person from the team to jump in.";

      return composeReplyResult({
        action: "GENERAL_REPLY",
        deterministicReply: reminderJustSaid ? honestAnswer : `${honestAnswer} ${pendingStep}`,
        requiredFacts: reminderJustSaid ? undefined : [pendingStep],
        llmClient: input.llmClient,
        tenantContext: input.tenantContext,
        latestUserMessage: input.message,
        conversationHistory: input.conversationHistory
      });
    }
  }

  // "Will I get seasick?" or "when's whale season?" mid-booking is still a question in its own right:
  // answer it before the booking context from earlier turns turns it into a booking step. A trip the
  // operator doesn't run is left to the honest "I don't have that" path further down.

  if (currentMessageAnalysis.intent === "GENERAL_QUESTION" && !namesTripNotOffered) {
    const ownTermsReply = (await answerKnowHow(input.bookingMemory?.productTitle ?? null)) ?? (await answerPick(true));
    if (ownTermsReply) return ownTermsReply;

    // "Can I bring my dog?" while Kai is waiting on a time: an honest word, then back to the booking,
    // rather than a reply that ignores the question. Anything that could be the booking step itself
    // ("can we do 1:30?", "is it ok if I use my work email?") is left to the booking flow.
    if (pendingStep && isQuestionShaped(input.message) && !mightBeBookingStepAnswer(input.message, input.bookingMemory)) {
      const honestAnswer =
        "Good question. I don't want to give you a dud answer on that one, so I won't guess. Just ask if you'd like a person from the team to jump in.";

      return composeReplyResult({
        action: "GENERAL_REPLY",
        deterministicReply: reminderJustSaid ? honestAnswer : `${honestAnswer} ${pendingStep}`,
        requiredFacts: reminderJustSaid ? undefined : [pendingStep],
        llmClient: input.llmClient,
        tenantContext: input.tenantContext,
        latestUserMessage: input.message,
        conversationHistory: input.conversationHistory
      });
    }
  }

  const capture = evaluateBookingCapture({
    message: input.message,
    priorTravellerMessages: input.priorTravellerMessages ?? [],
    bookingMemory: {
      ...(input.bookingMemory ?? {}),
      productExternalId: input.bookingMemory?.productExternalId ?? null,
      productTitle: effectiveSlots.productHint ?? input.bookingMemory?.productTitle ?? null,
      dateText: effectiveSlots.dateText,
      guests: effectiveSlots.guests
    }
  });
  // The context-widened `analysis` is only trustworthy for this check while a booking slot is
  // still genuinely missing - that's the "for 2 guests" reply completing an earlier explicit
  // "can you check availability" request, and the context-widened re-analysis correctly surfaces
  // CHECK_AVAILABILITY from that real prior message. Once product/date/guests were ALREADY fully
  // known before this turn, bookingMemoryToContext always embeds all three verbatim regardless of
  // what the traveller just said, so classifyIntent's productHint&&dateText&&guests rule fires on
  // every subsequent generic reply (a bare "yes", "ok", etc.) even with no real availability
  // question anywhere - silently stalling an already-active capture. resolvedIntent (the router's
  // opinion) is deliberately excluded from this whole check too: an active capture is a committed
  // state-machine transition, not just reply-text selection, so neither a context-widening artifact
  // nor a router guess should be able to re-suppress it.
  const wasAlreadyFullySlotted = Boolean(
    input.bookingMemory?.productTitle && input.bookingMemory?.dateText && input.bookingMemory?.guests
  );
  const shouldHandleCapture =
    capture.active &&
    (capture.ready ||
      (currentMessageAnalysis.intent !== "CHECK_AVAILABILITY" &&
        (wasAlreadyFullySlotted || analysis.intent !== "CHECK_AVAILABILITY")));
  const timeOptions = input.bookingMemory?.timeOptions ?? [];
  const rememberedTime = selectedTimeOption(input.bookingMemory?.dateText, timeOptions);
  const ticketOptions = input.bookingMemory?.ticketOptions ?? [];
  const awaitingContactForSelectedTickets =
    input.bookingWriteEnabled === true &&
    Boolean(input.bookingMemory?.ticketQuantities?.length) &&
    !(input.bookingMemory?.extraOptions?.length && input.bookingMemory.extraQuantities == null) &&
    capture.missingBookingSlots.length === 0 &&
    capture.missingContactSlots.length > 0;
  const contactMessageLooksLikeBookingChange =
    Boolean(currentMessageAnalysis.slots.dateText) ||
    Boolean(currentMessageAnalysis.slots.guests) ||
    Boolean(timeOptions.length > 1 && parseSelectedTimeOption(input.message, timeOptions)) ||
    Boolean(ticketOptions.length > 1 && parseTicketQuantities(input.message, ticketOptions, input.bookingMemory?.guests).length > 0);

  if (awaitingContactForSelectedTickets && !contactMessageLooksLikeBookingChange) {
    return {
      action: "BOOKING_DETAILS_REQUIRED",
      reply: composeContactCollectionReply(capture),
      replySource: "DETERMINISTIC",
      inquiryDraft: null,
      bookingStatePatch: buildContactCollectionState({
        memory: input.bookingMemory,
        capture
      })
    };
  }

  const productSelection = selectedProductFromRecentList({
    message: input.message,
    products: await listProducts(),
    history: input.conversationHistory
  });

  // Reported live on WhatsApp, 2026-09-21: a traveller who had an older, unrelated productTitle
  // still sitting in bookingMemory (from a much earlier turn/session) replied "1"/"option 1" to a
  // numbered list Kai had *just* shown, and got a generic "I can help with availability, booking, or
  // handing you off to the team" instead of the selection - the stale memory blocked this whole
  // branch outright. selectedProductFromRecentList already gates strictly on
  // recentAssistantOfferedProductList (the *very last* assistant turn actually being this list), so
  // that recency check alone is enough to trust a numbered reply over whatever old memory happens to
  // hold - the same way naming a different product by name elsewhere in this file (see "switches
  // product context when the traveller asks about another product") is already allowed to override
  // stale memory.
  if (productSelection) {
    if (productSelection.bookingMode === "MANUAL_INQUIRY") {
      return {
        action: "MANUAL_INQUIRY_REQUIRED",
        reply: composeManualInquiryReply(productSelection.title),
        replySource: "DETERMINISTIC"
      };
    }

    return {
      action: "PRODUCT_LINK",
      reply: formatProductInfoReply(productSelection),
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: productSelection.externalProductId,
        productTitle: productSelection.title,
        dateText: input.bookingMemory?.dateText ?? null,
        guests: input.bookingMemory?.guests ?? null,
        travellerName: input.bookingMemory?.travellerName ?? null,
        travellerEmail: input.bookingMemory?.travellerEmail ?? null,
        travellerPhone: input.bookingMemory?.travellerPhone ?? null,
        bookingStatus: input.bookingMemory?.bookingStatus ?? "DRAFT",
        confirmationSummary: input.bookingMemory?.confirmationSummary ?? null,
        externalBookingId: input.bookingMemory?.externalBookingId ?? null,
        externalProvider: (input.bookingMemory?.externalProvider as BookingFlowState["externalProvider"]) ?? null,
        bookingError: input.bookingMemory?.bookingError ?? null
      }
    };
  }

  if (timeOptions.length > 1 && !rememberedTime) {
    // A time the traveller gave before the times were on screen ("1:30 please") still counts,
    // unless this message turns it down.
    const parsedTime =
      parseSelectedTimeOption(input.message, timeOptions) ??
      (declinesSuggestion(input.message) ? null : findEarlierClockSelection(input.priorTravellerMessages ?? [], timeOptions));

    if (parsedTime) {
      const timeStatePatch: BookingFlowState = {
        productExternalId: input.bookingMemory?.productExternalId ?? null,
        productTitle: input.bookingMemory?.productTitle ?? null,
        dateText: parsedTime.startTimeLocal,
        guests: input.bookingMemory?.guests ?? null,
        travellerName: input.bookingMemory?.travellerName ?? null,
        travellerEmail: input.bookingMemory?.travellerEmail ?? null,
        travellerPhone: input.bookingMemory?.travellerPhone ?? null,
        bookingStatus: "AVAILABILITY_CHECKED",
        confirmationSummary: null,
        externalBookingId: null,
        externalProvider: null,
        bookingError: null,
        timeOptions,
        ticketOptions: input.bookingMemory?.ticketOptions ?? null,
        ticketQuantities: input.bookingMemory?.ticketQuantities ?? null,
        ...(input.bookingMemory?.extraOptions ? { extraOptions: input.bookingMemory.extraOptions } : {}),
        ...(input.bookingMemory?.extraOptions
          ? { extraQuantities: input.bookingMemory?.extraQuantities ?? null }
          : {})
      };
      const rememberedTicketOptions = input.bookingMemory?.ticketOptions ?? [];

      if (rememberedTicketOptions.length > 1 && !input.bookingMemory?.ticketQuantities) {
        return {
          action: "BOOKING_TICKET_SELECTION_REQUIRED",
          reply: `Got it: ${input.bookingMemory?.productTitle} ${formatDateAndTime(
            parsedTime.startTimeLocal
          )} for ${input.bookingMemory?.guests} guest${
            input.bookingMemory?.guests === 1 ? "" : "s"
          }.\n\nTicket options:\n${formatTicketOptionsList(
            rememberedTicketOptions,
            optionsCurrency(rememberedTicketOptions)
          )}\n\nWhich ticket suits? Just say "option 2" or "${optionExample(rememberedTicketOptions)}".`,
          replySource: "DETERMINISTIC",
          bookingStatePatch: timeStatePatch
        };
      }

      return {
        action: "BOOKING_DETAILS_REQUIRED",
        reply: `Got it: ${input.bookingMemory?.productTitle} ${formatDateAndTime(
          parsedTime.startTimeLocal
        )} for ${input.bookingMemory?.guests} guest${
          input.bookingMemory?.guests === 1 ? "" : "s"
        }. Pop through your name, email and phone number and I'll set up secure payment.`,
        replySource: "DETERMINISTIC",
        inquiryDraft: null,
        bookingStatePatch: timeStatePatch
      };
    }

    if (
      shouldHandleCapture ||
      Boolean(currentMessageAnalysis.slots.dateText) ||
      Boolean(currentMessageAnalysis.slots.guests) ||
      isBookingConfirmationMessage(input.message)
    ) {
      return {
        action: "BOOKING_TIME_SELECTION_REQUIRED",
        reply: optionsAlreadyShown(input.conversationHistory, timeOptions.map((option) => option.label))
          ? `I just need a time first: ${formatOrList(timeOptions.map((option) => option.label))}?`
          : `Here are the available times:\n${formatTimeOptionsList(timeOptions)}\n\nNothing's booked yet, so pick whichever suits.`,
        replySource: "DETERMINISTIC"
      };
    }
  }

  if (ticketOptions.length > 1 && !input.bookingMemory?.ticketQuantities) {
    const correctedTime =
      timeOptions.length > 1
        ? parseSelectedTimeOption(input.message, timeOptions, { allowBareNumberFallback: false })
        : null;
    const dateTextForTicketSelection =
      correctedTime?.startTimeLocal ?? input.bookingMemory?.dateText ?? null;
    const parsedTicketQuantities = parseTicketQuantities(input.message, ticketOptions, input.bookingMemory?.guests);

    if (parsedTicketQuantities.length > 0) {
      const participantCount = ticketParticipantCount(parsedTicketQuantities);

      if (input.bookingMemory?.guests && participantCount !== input.bookingMemory.guests) {
        return {
          action: "BOOKING_TICKET_SELECTION_REQUIRED",
          reply: `Those tickets add up to ${participantCount} ${participantCount === 1 ? "person" : "people"}, but we were checking ${
            input.bookingMemory.guests
          }. Can you pick tickets for ${input.bookingMemory.guests} ${input.bookingMemory.guests === 1 ? "person" : "people"}?`,
          replySource: "DETERMINISTIC"
        };
      }

      const ticketStatePatch: BookingFlowState = {
        productExternalId: input.bookingMemory?.productExternalId ?? null,
        productTitle: input.bookingMemory?.productTitle ?? null,
        dateText: dateTextForTicketSelection,
        guests: input.bookingMemory?.guests ?? participantCount,
        travellerName: input.bookingMemory?.travellerName ?? null,
        travellerEmail: input.bookingMemory?.travellerEmail ?? null,
        travellerPhone: input.bookingMemory?.travellerPhone ?? null,
        bookingStatus: "AVAILABILITY_CHECKED",
        confirmationSummary: null,
        externalBookingId: null,
        externalProvider: null,
        bookingError: null,
        ...(input.bookingMemory?.timeOptions ? { timeOptions: input.bookingMemory.timeOptions } : {}),
        ticketOptions,
        ticketQuantities: parsedTicketQuantities,
        ...(input.bookingMemory?.extraOptions ? { extraOptions: input.bookingMemory.extraOptions } : {}),
        ...(input.bookingMemory?.extraOptions
          ? { extraQuantities: input.bookingMemory?.extraQuantities ?? null }
          : {})
      };
      const extraOptions = input.bookingMemory?.extraOptions ?? [];

      if (extraOptions.length > 0 && input.bookingMemory?.extraQuantities == null) {
        return {
          action: "BOOKING_EXTRAS_SELECTION_REQUIRED",
          reply: `Got it: ${input.bookingMemory?.productTitle} ${formatDateAndTime(
            dateTextForTicketSelection
          )} for ${input.bookingMemory?.guests ?? participantCount} guest${
            (input.bookingMemory?.guests ?? participantCount) === 1 ? "" : "s"
          } with ${formatTicketQuantities(
            parsedTicketQuantities
          )}.\n\nOptional extras:\n${formatExtraOptionsList(
            extraOptions,
            optionsCurrency(extraOptions, ticketOptions)
          )}\n\nWant to add any? Just say "no extras" or "${optionExample(extraOptions)}".`,
          replySource: "DETERMINISTIC",
          bookingStatePatch: ticketStatePatch
        };
      }

      return {
        action: "BOOKING_DETAILS_REQUIRED",
        reply: `Got it: ${input.bookingMemory?.productTitle} ${formatDateAndTime(
          dateTextForTicketSelection
        )} for ${input.bookingMemory?.guests ?? participantCount} guest${
          (input.bookingMemory?.guests ?? participantCount) === 1 ? "" : "s"
        } with ${formatTicketQuantities(parsedTicketQuantities)}. Pop through your name, email and phone number and I'll set up secure payment.`,
        replySource: "DETERMINISTIC",
        inquiryDraft: null,
        bookingStatePatch: ticketStatePatch
      };
    }

    if (correctedTime && correctedTime.startTimeLocal !== input.bookingMemory?.dateText) {
      const correctedTimeStatePatch: BookingFlowState = {
        productExternalId: input.bookingMemory?.productExternalId ?? null,
        productTitle: input.bookingMemory?.productTitle ?? null,
        dateText: correctedTime.startTimeLocal,
        guests: input.bookingMemory?.guests ?? null,
        travellerName: input.bookingMemory?.travellerName ?? null,
        travellerEmail: input.bookingMemory?.travellerEmail ?? null,
        travellerPhone: input.bookingMemory?.travellerPhone ?? null,
        bookingStatus: "AVAILABILITY_CHECKED",
        confirmationSummary: null,
        externalBookingId: null,
        externalProvider: null,
        bookingError: null,
        ...(input.bookingMemory?.timeOptions ? { timeOptions: input.bookingMemory.timeOptions } : {}),
        ticketOptions,
        ticketQuantities: null,
        ...(input.bookingMemory?.extraOptions ? { extraOptions: input.bookingMemory.extraOptions } : {}),
        ...(input.bookingMemory?.extraOptions
          ? { extraQuantities: input.bookingMemory?.extraQuantities ?? null }
          : {})
      };

      return {
        action: "BOOKING_TICKET_SELECTION_REQUIRED",
        reply: `Got it: ${input.bookingMemory?.productTitle} ${formatDateAndTime(
          correctedTime.startTimeLocal
        )} for ${input.bookingMemory?.guests} guest${
          input.bookingMemory?.guests === 1 ? "" : "s"
        }.\n\nTicket options:\n${formatTicketOptionsList(
          ticketOptions,
          optionsCurrency(ticketOptions)
        )}\n\nWhich ticket suits, and how many?`,
        replySource: "DETERMINISTIC",
        bookingStatePatch: correctedTimeStatePatch
      };
    }

    if (
      shouldHandleCapture ||
      Boolean(currentMessageAnalysis.slots.dateText) ||
      Boolean(currentMessageAnalysis.slots.guests) ||
      isBookingConfirmationMessage(input.message)
    ) {
      return {
        action: "BOOKING_TICKET_SELECTION_REQUIRED",
        reply: `Ticket options for ${input.bookingMemory?.guests} ${
          input.bookingMemory?.guests === 1 ? "person" : "people"
        }:\n${formatTicketOptionsList(
          ticketOptions,
          optionsCurrency(ticketOptions)
        )}\n\nWhich would you like? For example, "1 x 2 people" or "2 adults".`,
        replySource: "DETERMINISTIC"
      };
    }
  }

  const extraOptions = input.bookingMemory?.extraOptions ?? [];
  if (extraOptions.length > 0 && input.bookingMemory?.extraQuantities == null && input.bookingMemory?.ticketQuantities) {
    const parsedExtraQuantities = parseExtraQuantities(input.message, extraOptions);

    if (parsedExtraQuantities !== null) {
      const extraStatePatch: BookingFlowState = {
        productExternalId: input.bookingMemory.productExternalId ?? null,
        productTitle: input.bookingMemory.productTitle ?? null,
        dateText: input.bookingMemory.dateText ?? null,
        guests: input.bookingMemory.guests ?? null,
        travellerName: input.bookingMemory.travellerName ?? null,
        travellerEmail: input.bookingMemory.travellerEmail ?? null,
        travellerPhone: input.bookingMemory.travellerPhone ?? null,
        bookingStatus: "AVAILABILITY_CHECKED",
        confirmationSummary: null,
        externalBookingId: null,
        externalProvider: null,
        bookingError: null,
        ...(input.bookingMemory.timeOptions ? { timeOptions: input.bookingMemory.timeOptions } : {}),
        ...(input.bookingMemory.ticketOptions ? { ticketOptions: input.bookingMemory.ticketOptions } : {}),
        ticketQuantities: input.bookingMemory.ticketQuantities,
        extraOptions,
        extraQuantities: parsedExtraQuantities
      };
      const extraReplyPrefix =
        parsedExtraQuantities.length === 0
          ? "No extras, no worries."
          : `Added ${formatExtraQuantities(parsedExtraQuantities)}.`;

      return {
        action: "BOOKING_DETAILS_REQUIRED",
        reply: `${extraReplyPrefix} Pop through your name, email and phone number and I'll set up secure payment.`,
        replySource: "DETERMINISTIC",
        bookingStatePatch: extraStatePatch
      };
    }

    return {
      action: "BOOKING_EXTRAS_SELECTION_REQUIRED",
      reply: `Optional extras:\n${formatExtraOptionsList(
        extraOptions,
        optionsCurrency(extraOptions, input.bookingMemory?.ticketOptions)
      )}\n\nWant to add any? Just say "no extras" or "${optionExample(extraOptions)}".`,
      replySource: "DETERMINISTIC"
    };
  }

  if (isProductLinkRequest(input.message) && input.bookingMemory?.productTitle) {
    const products = await input.pmsAdapter.listProducts();
    const product = products.find(
      (candidate) =>
        candidate.externalProductId === input.bookingMemory?.productExternalId ||
        candidate.title === input.bookingMemory?.productTitle
    );

    if (product?.productUrl) {
      return {
        action: "PRODUCT_LINK",
        reply: `Sure thing, here's the page for ${product.title}: ${product.productUrl}. Have a look, and if it feels right, just tell me you'd like to go ahead.`,
        replySource: "DETERMINISTIC"
      };
    }

    if (product) {
      return {
        action: "PRODUCT_LINK",
        reply: `I don't have a page link for ${product.title} yet, but I can help with times, prices and booking right here.`,
        replySource: "DETERMINISTIC"
      };
    }
  }

  // The capture flow below (composeBookingCaptureReply's own copy: "I will send this to the
  // operator for confirmation") was built for MANUAL_INQUIRY products, where there is no live PMS
  // availability to check - collecting contact details and handing the lead to the operator IS the
  // whole flow. For an AUTO_BOOKING (live-Rezdy) product it must only take over AFTER a real
  // getAvailability check already happened this conversation (evidenced by bookingMemory carrying
  // ticketQuantities/timeOptions/ticketOptions, or a bookingStatus already past DRAFT) - that's the
  // legitimate "ticket already selected, now just finishing contact details" continuation, and it
  // deliberately must NOT call getAvailability again (existing tests assert exactly that). Confirmed
  // live that without this guard, a free-text booking-intent phrase ("i want that", "book it")
  // combined with an already-known product/date/guests let this block skip straight to asking for
  // contact details - and, once given, straight to pmsAdapter.createBooking - without EVER calling
  // getAvailability, so the traveller never saw a real time slot or real ticket price before payment
  // was requested. A bare product/date/guests match alone is not enough evidence; only a genuine
  // prior availability check is.
  const capturedProduct = (await listProducts()).find(
    (candidate) =>
      candidate.externalProductId === capture.details.productExternalId || candidate.title === capture.details.productTitle
  );
  const hasCheckedRealAvailabilityAlready = Boolean(
    input.bookingMemory?.ticketQuantities?.length ||
      input.bookingMemory?.timeOptions?.length ||
      input.bookingMemory?.ticketOptions?.length ||
      (input.bookingMemory?.bookingStatus && input.bookingMemory.bookingStatus !== "DRAFT")
  );
  // Only matters once product/date/guests are ALL already known - capture's own "please share the
  // X" replies while slots are still missing are harmless regardless of product type (nothing has
  // been checked yet, so there is nothing to skip).
  const captureAppliesToKnownProduct =
    capture.missingBookingSlots.length > 0 ||
    !capturedProduct ||
    capturedProduct.bookingMode !== "AUTO_BOOKING" ||
    hasCheckedRealAvailabilityAlready;

  if (shouldHandleCapture && captureAppliesToKnownProduct) {
    if (
      !capture.ready &&
      input.bookingWriteEnabled === true &&
      capture.missingBookingSlots.length === 0 &&
      capture.missingContactSlots.length > 0
    ) {
      const products = await input.pmsAdapter.listProducts();
      const product = products.find(
        (candidate) =>
          candidate.externalProductId === capture.details.productExternalId ||
          candidate.title === capture.details.productTitle
      );

      if (product?.bookingMode === "AUTO_BOOKING") {
        return {
          action: "BOOKING_DETAILS_REQUIRED",
          reply: `Nice. To book ${capture.details.productTitle} for ${capture.details.guests} guest${
            capture.details.guests === 1 ? "" : "s"
          } ${formatDatePhrase(
            capture.details.dateText
          )}, I just need your name, email and phone number. I'll run the details past you once more before anything's booked.`,
          replySource: "DETERMINISTIC",
          inquiryDraft: null
        };
      }
    }

    if (capture.ready && input.bookingWriteEnabled === false) {
      const products = await input.pmsAdapter.listProducts();
      const product = products.find(
        (candidate) =>
          candidate.externalProductId === capture.details.productExternalId ||
          candidate.title === capture.details.productTitle
      );

      if (product?.bookingMode === "AUTO_BOOKING") {
        return {
          action: "BOOKING_WRITE_DISABLED",
          reply: `Thanks, I've got the details for ${capture.details.productTitle} ${formatDatePhrase(
            capture.details.dateText
          )} for ${capture.details.guests} guest${
            capture.details.guests === 1 ? "" : "s"
          }. I'll send this to the operator to confirm, and they'll get back to you.`,
          replySource: "DETERMINISTIC",
          inquiryDraft: capture.details
        };
      }
    }

    if (capture.ready && input.bookingWriteEnabled === true) {
      const products = await input.pmsAdapter.listProducts();
      const product = products.find(
        (candidate) =>
          candidate.externalProductId === capture.details.productExternalId ||
          candidate.title === capture.details.productTitle
      );

      if (product?.bookingMode === "AUTO_BOOKING") {
        const capturedState = captureBookingDetails(capture.details);
        const readyState = markBookingReadyToConfirm({
          ...capturedState,
          ...(input.bookingMemory?.ticketOptions ? { ticketOptions: input.bookingMemory.ticketOptions } : {}),
          ...(input.bookingMemory?.ticketQuantities ? { ticketQuantities: input.bookingMemory.ticketQuantities } : {}),
          ...(input.bookingMemory?.extraOptions ? { extraOptions: input.bookingMemory.extraOptions } : {}),
          ...(input.bookingMemory?.extraQuantities ? { extraQuantities: input.bookingMemory.extraQuantities } : {})
        });
        const ticketSummary = readyState.ticketQuantities?.length
          ? ` with ${formatTicketQuantities(readyState.ticketQuantities)}`
          : "";
        const extraSummary =
          readyState.extraQuantities && readyState.extraQuantities.length > 0
            ? ` and ${formatExtraQuantities(readyState.extraQuantities)}`
            : "";
        const paymentState: BookingFlowState = {
          ...readyState,
          ...(input.bookingMemory?.timeOptions ? { timeOptions: input.bookingMemory.timeOptions } : {}),
          bookingStatus: "PAYMENT_PENDING",
          bookingError: "Awaiting secure payment before creating the external booking."
        };
        if (input.rezdyCheckoutHandoff) {
          const handoffUrl =
            input.rezdyCheckoutHandoff.buildUrl({
              productExternalId: readyState.productExternalId ?? null,
              productUrl: product.productUrl ?? null,
              dateText: readyState.dateText ?? null,
              timeOptions: input.bookingMemory?.timeOptions ?? null
            }) ?? product.productUrl ?? null;

          if (handoffUrl) {
            const operatorName = input.tenantContext?.tenantName ?? "the operator";
            return {
              action: "BOOKING_PAYMENT_REQUIRED",
              reply:
                `Thanks, I've got everything for ${readyState.productTitle} ${formatDateAndTime(readyState.dateText)} for ${
                  readyState.guests
                } guest${readyState.guests === 1 ? "" : "s"}${ticketSummary}${extraSummary} under ${readyState.travellerName}.\n\n` +
                `To finish, open ${operatorName}'s own booking page and pay securely there: ${handoffUrl}\n\n` +
                `I never see or store your card details, and your confirmation and booking reference come from ${operatorName} by email.`,
              replySource: "DETERMINISTIC",
              bookingStatePatch: { ...paymentState, bookingError: null },
              paymentHandoffUrl: handoffUrl,
              rezdyHandoff: true
            };
          }
          // No page to send them to: fall through to the usual "the operator will be in touch" reply.
        }

        let paymentOrder:
          | {
              externalBookingId: string;
              provider: PmsAdapter["provider"];
              paymentUrl?: string | null;
            }
          | null = null;
        let paymentOrderError: string | null = null;
        const shouldReserveExternalHold =
          input.allowUnpaidExternalBooking === true || input.bluePassStripeCheckoutEnabled === true;

        if (shouldReserveExternalHold) {
          try {
            paymentOrder = await createPendingPaymentOrder({
              pmsAdapter: input.pmsAdapter,
              state: paymentState
            });
          } catch (error) {
            paymentOrderError = error instanceof Error ? error.message : "PMS payment hold request failed.";
          }
        }

        const paymentStateWithOrder: BookingFlowState = paymentOrder
          ? {
              ...paymentState,
              externalBookingId: paymentOrder.externalBookingId,
              externalProvider: paymentOrder.provider,
              bookingError: null
            }
          : {
              ...paymentState,
              bookingError: paymentOrderError ?? paymentState.bookingError
            };

        if (paymentOrder && input.bluePassStripeCheckoutEnabled === true) {
          const pricing = calculateBookingGrossAmountCents({
            guests: readyState.guests,
            ticketOptions: readyState.ticketOptions,
            ticketQuantities: readyState.ticketQuantities,
            extraOptions: readyState.extraOptions,
            extraQuantities: readyState.extraQuantities
          });

          if (
            pricing &&
            readyState.productExternalId &&
            readyState.productTitle &&
            readyState.dateText &&
            readyState.guests &&
            readyState.travellerName &&
            readyState.travellerEmail
          ) {
            const pmsCheckoutHold: PmsCheckoutHold = {
              externalBookingId: paymentOrder.externalBookingId,
              pmsProvider: paymentOrder.provider,
              productExternalId: readyState.productExternalId,
              productTitle: readyState.productTitle,
              dateText: readyState.dateText,
              guests: readyState.guests,
              travellerName: readyState.travellerName,
              travellerEmail: readyState.travellerEmail,
              travellerPhone: readyState.travellerPhone,
              ticketQuantities: pricing.resolvedTicketQuantities,
              extraQuantities: readyState.extraQuantities ?? null,
              grossAmountCents: pricing.grossAmountCents,
              currency: optionsCurrency(readyState.ticketOptions, readyState.extraOptions)
            };

            return {
              action: "BOOKING_PAYMENT_REQUIRED",
              reply: `Thanks, I've got everything for ${readyState.productTitle} ${formatDateAndTime(
                readyState.dateText
              )} for ${
                readyState.guests
              } guest${readyState.guests === 1 ? "" : "s"}${ticketSummary}${extraSummary} under ${readyState.travellerName}, ${
                readyState.travellerEmail
              }, ${readyState.travellerPhone}.\n\nI'm setting up your secure payment link now.`,
              replySource: "DETERMINISTIC",
              inquiryDraft: capture.details,
              bookingStatePatch: paymentStateWithOrder,
              pmsCheckoutHold
            };
          }
          // pricing === null (or a required detail was unexpectedly missing): fall through to the
          // existing "saved as a lead, operator will follow up" reply below - never silently charge
          // an unpriceable booking.
        }

        const paymentHandoffUrl = paymentOrder?.paymentUrl ?? null;
        const paymentInstruction = paymentOrder
          ? paymentHandoffUrl
            ? `I've put a hold on it with the operator (order ${paymentOrder.externalBookingId}). You can pay on the secure Rezdy payment link below, and I never see or store your card details.`
            : `I've put a hold on it with the operator (reference ${paymentOrder.externalBookingId}), and they'll send you a secure payment link or be in touch to finish up. I never see or store your card details.`
          : `I've passed this to the operator, and they'll be in touch to sort out payment. I never see or store your card details.`;

        return {
          action: "BOOKING_PAYMENT_REQUIRED",
          reply: `Thanks, I've got everything for ${readyState.productTitle} ${formatDateAndTime(
            readyState.dateText
          )} for ${
            readyState.guests
          } guest${readyState.guests === 1 ? "" : "s"}${ticketSummary}${extraSummary} under ${readyState.travellerName}, ${
            readyState.travellerEmail
          }, ${
            readyState.travellerPhone
          }.\n\n${paymentInstruction}`,
          replySource: "DETERMINISTIC",
          inquiryDraft: capture.details,
          bookingStatePatch: paymentStateWithOrder,
          ...(paymentHandoffUrl ? { paymentHandoffUrl } : {})
        };
      }
    }

    return {
      action: capture.ready ? "BOOKING_INQUIRY_READY" : "BOOKING_DETAILS_REQUIRED",
      reply: composeBookingCaptureReply(capture),
      replySource: "DETERMINISTIC",
      inquiryDraft: capture.ready ? capture.details : null
    };
  }

  if (resolvedIntent === "HUMAN_HANDOFF") {
    // "Am I talking to a real person?" trips the handoff words but is a question about Kai.
    const smallTalk = findBookingSmallTalkReply(input.message, { tenantName: input.tenantContext?.tenantName });
    if (smallTalk) {
      return { action: "GENERAL_REPLY", reply: smallTalk.reply, replySource: "DETERMINISTIC" };
    }

    const pack = input.knowledgePack ?? null;
    // An operator-authored handoff line, or a knowledge answer if the handoff was actually a
    // policy question we can answer.
    const knowledgeAnswer = pack ? matchKnowledgeEntry(input.message, pack) : null;
    if (knowledgeAnswer) {
      return composeReplyResult({
        action: "GENERAL_REPLY",
        deterministicReply: knowledgeAnswer.answer,
        requiredFacts: knowledgeAnswer.isPolicy ? [knowledgeAnswer.answer] : [],
        llmClient: input.llmClient,
        tenantContext: input.tenantContext,
        latestUserMessage: input.message,
        conversationHistory: input.conversationHistory
      });
    }
    return composeReplyResult({
      action: "HUMAN_HANDOFF",
      deterministicReply:
        pack?.escalation.handoffMessage ?? buildHumanHandoffReply({ channel: input.channel ?? "web", nothingChanges: true }),
      requiredFacts: pack?.escalation.handoffMessage ? [pack.escalation.handoffMessage] : undefined,
      llmClient: input.llmClient,
      tenantContext: input.tenantContext,
      latestUserMessage: input.message,
      conversationHistory: input.conversationHistory
    });
  }

  // Once a product is already selected, only re-enter product-recommendation handling when the
  // traveller's CURRENT message (not the context-widened `analysis`) itself asks for one.
  // bookingMemoryToContext re-embeds the already-selected product's name into every context-widened
  // re-analysis, and old conversation history can carry stale keywords (e.g. "options" from an
  // earlier "what options do you have?") - together these can misclassify a typo'd detail reply
  // (e.g. "22july for 2 poeple", where "poeple" fails guest extraction) as PRODUCT_RECOMMENDATION,
  // looping the traveller back to product selection/info instead of progressing toward the missing
  // detail or availability check below.
  const shouldTreatAsProductRecommendation =
    resolvedIntent === "PRODUCT_RECOMMENDATION" &&
    (!input.bookingMemory?.productTitle || currentMessageAnalysis.intent === "PRODUCT_RECOMMENDATION");

  if (shouldTreatAsProductRecommendation) {
    const products = await listProducts();
    // "Info on the whale escape" names the trip in the traveller's own words, even when it isn't one
    // of the stock product hints.
    const asksAboutATrip = /\b(?:know about|learn about|tell me about|more about|info (?:about|on)|details? (?:about|on)|curious about)\b/i.test(
      input.message
    );
    const productMatch = analysis.slots.productHint
      ? matchPmsProduct(analysis.slots.productHint, products)
      : asksAboutATrip
        ? matchPmsProduct(input.message, products)
        : null;

    if (productMatch?.status === "MATCHED") {
      return {
        action: "PRODUCT_LINK",
        reply: formatProductInfoReply(productMatch.product),
        replySource: "DETERMINISTIC"
      };
    }

    const pickReply = await answerPick(false);
    if (pickReply) return pickReply;

    // kai-conversation-flow-notes.md finding #2 (critical): across 9 traveller turns Kai never once
    // declined - it re-offered the same 4 products 3 times, including after "I don't want a yacht
    // charter." Once the traveller has already seen this exact list and still doesn't match anything
    // in it, silently re-showing it again reads as broken or dishonest - an honest "not yet, want me
    // to note your interest?" is the correct answer, per the brief's own §"say no, then capture".
    const alreadySawThisList = productListWasEverShown(input.conversationHistory, products);
    if (alreadySawThisList && !analysis.slots.productHint) {
      const email = extractEmailAddress(input.message);
      if (email) {
        return composeReplyResult({
          action: "HUMAN_HANDOFF",
          deterministicReply: `Thanks, I've got ${email}. The team can see this chat, so they can get in touch when something fits.`,
          requiredFacts: [email],
          llmClient: input.llmClient,
          tenantContext: input.tenantContext,
          latestUserMessage: input.message,
          conversationHistory: input.conversationHistory
        });
      }

      return {
        action: "PRODUCT_RECOMMENDATION",
        reply: buildScopeDeclineReply(),
        replySource: "DETERMINISTIC"
      };
    }

    return {
      action: "PRODUCT_RECOMMENDATION",
      reply: `${notOfferedPrefix(currentMessageAnalysis.slots.productHint, products)}${formatRecommendationReply(
        products,
        currentMessageAnalysis.slots.dateText
      )}`,
      replySource: "DETERMINISTIC",
      productCards: await buildProductCards({
        products,
        dateText: currentMessageAnalysis.slots.dateText,
        guests: effectiveSlots.guests,
        pmsAdapter: input.pmsAdapter,
        budgetAud: currentMessageAnalysis.slots.budget
      })
    };
  }

  if (resolvedIntent === "GENERAL_QUESTION") {
    // A hello, a thank you or "are you a bot?" gets a real answer, not the booking menu.
    const smallTalk = findBookingSmallTalkReply(input.message, { tenantName: input.tenantContext?.tenantName });
    if (smallTalk) {
      return { action: "GENERAL_REPLY", reply: smallTalk.reply, replySource: "DETERMINISTIC" };
    }

    const pack = input.knowledgePack ?? null;

    // Prefer an operator-authored answer when the question matches one.
    const knowledgeAnswer = pack ? matchKnowledgeEntry(input.message, pack) : null;
    if (knowledgeAnswer) {
      return composeReplyResult({
        action: "GENERAL_REPLY",
        deterministicReply: knowledgeAnswer.answer,
        // Policy answers are forced verbatim through any LLM rephrase.
        requiredFacts: knowledgeAnswer.isPolicy ? [knowledgeAnswer.answer] : [],
        llmClient: input.llmClient,
        tenantContext: input.tenantContext,
        latestUserMessage: input.message,
        conversationHistory: input.conversationHistory
      });
    }

    const suggestionReply = await answerPick(true);
    if (suggestionReply) return suggestionReply;

    // "Do you do the reef snorkel?" deserves a straight yes or no, not a change of subject.
    const askedProduct = currentMessageAnalysis.slots.productHint;
    let askedProductTitle: string | null = null;
    if (askedProduct) {
      const catalogue = await listProducts();
      const notOffered = notOfferedPrefix(askedProduct, catalogue);
      const askedMatch = matchPmsProduct(askedProduct, catalogue);

      if (notOffered && catalogue.length > 0 && askedMatch.status !== "MATCHED") {
        return {
          action: "PRODUCT_RECOMMENDATION",
          reply: `${notOffered}${formatRecommendationReply(catalogue, currentMessageAnalysis.slots.dateText)}`,
          replySource: "DETERMINISTIC",
          productCards: await buildProductCards({
            products: catalogue,
            dateText: currentMessageAnalysis.slots.dateText,
            guests: effectiveSlots.guests,
            pmsAdapter: input.pmsAdapter,
            budgetAud: currentMessageAnalysis.slots.budget
          })
        };
      }

      if (askedMatch.status === "MATCHED" && isOfferQuestion(input.message)) {
        return {
          action: "GENERAL_REPLY",
          reply: `Yes, ${askedMatch.product.title} is one I can book for you. Tell me the date and how many of you, and I'll check it.`,
          replySource: "DETERMINISTIC"
        };
      }

      askedProductTitle = askedMatch.status === "MATCHED" ? askedMatch.product.title : null;
    }

    // A bare trip name ("the whale escape") is someone picking a trip, so tell them about it rather
    // than reading them the menu. So is a trip named with a wish or a group size ("I want the whale
    // escape for 3 of us"), which used to fall to the menu only because it ran past five words (found
    // by running the personality doc against production, 2026-10-03).
    const guestsNamed = extractGuestCount(input.message);
    const namesTrip =
      !isQuestionShaped(input.message) &&
      (input.message.trim().split(/\s+/).length <= 5 || wantsTripPattern.test(input.message) || guestsNamed !== undefined);
    if (namesTrip) {
      const named = matchPmsProduct(input.message, await listProducts());
      if (named.status === "MATCHED") {
        // Said how many already? Then ask only for the date, never the group size again.
        if (guestsNamed !== undefined && named.product.bookingMode !== "MANUAL_INQUIRY") {
          return {
            action: "PRODUCT_LINK",
            reply: `${named.product.title} for ${guestsNamed}, sounds good. What date works for you?`,
            replySource: "DETERMINISTIC",
            bookingStatePatch: {
              productExternalId: named.product.externalProductId,
              productTitle: named.product.title,
              dateText: input.bookingMemory?.dateText ?? null,
              guests: guestsNamed,
              travellerName: input.bookingMemory?.travellerName ?? null,
              travellerEmail: input.bookingMemory?.travellerEmail ?? null,
              travellerPhone: input.bookingMemory?.travellerPhone ?? null,
              bookingStatus: input.bookingMemory?.bookingStatus ?? "DRAFT",
              confirmationSummary: input.bookingMemory?.confirmationSummary ?? null,
              externalBookingId: input.bookingMemory?.externalBookingId ?? null,
              externalProvider: (input.bookingMemory?.externalProvider as BookingFlowState["externalProvider"]) ?? null,
              bookingError: input.bookingMemory?.bookingError ?? null
            }
          };
        }
        return { action: "PRODUCT_LINK", reply: formatProductInfoReply(named.product), replySource: "DETERMINISTIC" };
      }
    }

    // What a well-travelled mate would know (seasickness, stingers, when to go), plus the way to
    // real times and prices, before falling back to "I won't guess".
    const knowHowReply = await answerKnowHow(askedProductTitle ?? input.bookingMemory?.productTitle ?? null);
    if (knowHowReply) return knowHowReply;

    // No matching answer to a policy-shaped question -> hand to a human rather than let Kai
    // improvise a policy the operator never gave.
    if (
      pack &&
      pack.escalation.fallbackToHuman &&
      (isPolicyShapedQuestion(input.message) || matchesHandoffKeywords(input.message, pack))
    ) {
      return composeReplyResult({
        action: "HUMAN_HANDOFF",
        deterministicReply:
          pack.escalation.handoffMessage ?? buildHumanHandoffReply({ channel: input.channel ?? "web", escalation: true }),
        requiredFacts: pack.escalation.handoffMessage ? [pack.escalation.handoffMessage] : undefined,
        llmClient: input.llmClient,
        tenantContext: input.tenantContext,
        latestUserMessage: input.message,
        conversationHistory: input.conversationHistory
      });
    }

    return composeReplyResult({
      action: "GENERAL_REPLY",
      // A real question gets an honest "I won't guess", not the booking menu as if it wasn't asked.
      deterministicReply: isQuestionShaped(input.message)
        ? `Good question. I don't want to give you a dud answer on that one, so I won't guess. ${PERSON_OFFER}`
        : composeBookingBrainReply({ ...analysis, intent: resolvedIntent }),
      // The offer of a person has to survive any rewrite, or a "yes" to it can't be recognised.
      requiredFacts: isQuestionShaped(input.message) ? [PERSON_OFFER] : undefined,
      llmClient: input.llmClient,
      tenantContext: input.tenantContext,
      latestUserMessage: input.message,
      conversationHistory: input.conversationHistory
    });
  }

  if (missingSlots.includes("date") || missingSlots.includes("guests")) {
    // A named trip this operator doesn't run must never come back as "Nice, <that trip>": say so and
    // show what they do run instead. A trip already picked from their catalogue is trusted as is.
    const hintIsRememberedSelection =
      Boolean(input.bookingMemory?.productExternalId) &&
      effectiveSlots.productHint?.toLowerCase() === input.bookingMemory?.productTitle?.toLowerCase();

    if (effectiveSlots.productHint && !hintIsRememberedSelection) {
      const detailProducts = await listProducts();
      const notOffered = notOfferedPrefix(effectiveSlots.productHint, detailProducts);

      if (notOffered && detailProducts.length > 0 && matchPmsProduct(effectiveSlots.productHint, detailProducts).status !== "MATCHED") {
        return {
          action: "NEEDS_PRODUCT_SELECTION",
          reply: `${notOffered}${formatRecommendationReply(detailProducts, effectiveSlots.dateText)}`,
          replySource: "DETERMINISTIC",
          productCards: await buildProductCards({
            products: detailProducts,
            dateText: effectiveSlots.dateText,
            guests: effectiveSlots.guests,
            pmsAdapter: input.pmsAdapter,
            budgetAud: currentMessageAnalysis.slots.budget
          })
        };
      }
    }

    // "What dates are available?" with a product already known - answering with "please share a
    // date" is circular (see isAskingWhichDatesAvailable's own comment). Show the real calendar
    // instead, same mechanism as the post-unavailability branch below, defaulting to 1 guest until
    // the traveller says otherwise. Skipped for MANUAL_INQUIRY products (no PMS availability to
    // search) and every PMS but Rezdy (feature-detected, same as everywhere else this is used).
    if (!missingSlots.includes("product") && OPEN_DATE_QUESTION_PATTERN.test(input.message)) {
      const browseProducts = await listProducts();
      const browseMatch = matchPmsProduct(effectiveSlots.productHint ?? contextMessage, browseProducts);

      if (
        browseMatch.status === "MATCHED" &&
        browseMatch.product.bookingMode === "AUTO_BOOKING" &&
        input.pmsAdapter.findAvailableDates
      ) {
        const { dates } = await input.pmsAdapter.findAvailableDates({
          productId: browseMatch.product.externalProductId,
          guests: effectiveSlots.guests ?? 1,
          fromDate: "today",
          daysToSearch: 60
        });
        const guestsPhrase = effectiveSlots.guests
          ? ` for ${effectiveSlots.guests} guest${effectiveSlots.guests === 1 ? "" : "s"}`
          : "";

        return {
          action: "AVAILABILITY_CHECKED",
          reply:
            dates.length > 0
              ? `Here are the open dates for ${browseMatch.product.title}${guestsPhrase}. Pick one and I'll check the price.`
              : `I couldn't find any open dates for ${browseMatch.product.title}${guestsPhrase} in the next 60 days. Want me to pass this to the team, or look at a different trip?`,
          replySource: "DETERMINISTIC",
          dateOptions: dates.length > 0 ? dates : null
        };
      }
    }

    return {
      action: "NEEDS_MORE_DETAILS",
      reply: composeMissingDetailsReply({
        missingSlots,
        productTitle: effectiveSlots.productHint,
        dateText: effectiveSlots.dateText,
        guests: effectiveSlots.guests,
        message: input.message
      }),
      replySource: "DETERMINISTIC"
    };
  }

  const products = await listProducts();
  const productMatch = matchPmsProduct(currentMessageAnalysis.slots.productHint ?? contextMessage, products);

  if (productMatch.status !== "MATCHED") {
    // Deterministic, and reuses formatRecommendationReply verbatim - the same numbered,
    // "- live availability"/"- operator confirmation required" tagged list the PRODUCT_RECOMMENDATION
    // branch above already sends for "what do you have?". Any path that lands here is asking the same
    // question ("which product?"), so it must look identical regardless of which message shape
    // triggered it.
    return {
      action: "NEEDS_PRODUCT_SELECTION",
      reply: `${notOfferedPrefix(currentMessageAnalysis.slots.productHint, products)}${formatRecommendationReply(
        productMatch.products,
        effectiveSlots.dateText
      )}`,
      replySource: "DETERMINISTIC",
      productCards: await buildProductCards({
        products: productMatch.products,
        dateText: effectiveSlots.dateText,
        guests: effectiveSlots.guests,
        pmsAdapter: input.pmsAdapter,
        budgetAud: currentMessageAnalysis.slots.budget
      })
    };
  }

  const product = productMatch.product;

  if (product.bookingMode === "MANUAL_INQUIRY") {
    return {
      action: "MANUAL_INQUIRY_REQUIRED",
      reply: composeManualInquiryReply(product.title),
      replySource: "DETERMINISTIC"
    };
  }

  const availability = await input.pmsAdapter.getAvailability({
    productId: product.externalProductId,
    date: effectiveSlots.dateText ?? "",
    guests: effectiveSlots.guests ?? 0
  });

  if (!availability.available) {
    // Offered alongside the "not available" reply itself, rather than waiting for a follow-up like
    // "what date do you have?" - that follow-up carries no new date, so effectiveSlots.dateText
    // falls back to bookingMemory's already-failed date and re-runs the identical check, which
    // read as Kai repeating itself verbatim. Feature-detected: only the Rezdy adapters implement
    // this (see PmsAdapter.findAvailableDates), so every other PMS just gets no dates back.
    const dateOptions = input.pmsAdapter.findAvailableDates
      ? (
          await input.pmsAdapter.findAvailableDates({
            productId: product.externalProductId,
            guests: effectiveSlots.guests ?? 0,
            fromDate: effectiveSlots.dateText ?? "today",
            daysToSearch: 60
          })
        ).dates
      : [];

    const nextStep =
      dateOptions.length > 0
        ? "Here are some other dates with space, or I can check a different trip."
        : "Want me to check another date or a different trip?";
    const composed = await composeReplyResult({
      action: "AVAILABILITY_CHECKED",
      deterministicReply: `Sorry, ${product.title} isn't available for ${effectiveSlots.guests} guests ${formatDatePhrase(
        effectiveSlots.dateText
      )}. ${nextStep}`,
      requiredFacts: [
        product.title,
        `${effectiveSlots.guests} guests`,
        effectiveSlots.dateText ? formatDateForSentence(effectiveSlots.dateText) : "",
        "isn't available"
      ],
      llmClient: input.llmClient,
      tenantContext: input.tenantContext,
      latestUserMessage: input.message,
      conversationHistory: input.conversationHistory
    });

    return { ...composed, dateOptions: dateOptions.length > 0 ? dateOptions : null };
  }

  const onlyAvailableTime =
    input.bookingWriteEnabled === true && availability.timeOptions?.length === 1 ? availability.timeOptions[0] : null;
  const availabilityDateText = onlyAvailableTime?.startTimeLocal ?? effectiveSlots.dateText;
  const onlyAvailableTimeSentence = onlyAvailableTime
    ? ` The only available time is ${onlyAvailableTime.label}.`
    : "";

  if (input.bookingWriteEnabled === true && availability.timeOptions && availability.timeOptions.length > 1) {
    const requestedTime = findEarlierClockSelection([...(input.priorTravellerMessages ?? []), input.message], availability.timeOptions);
    const timeLabels = availability.timeOptions.map((option) => option.label);
    // Same trip and the same times already on screen: a short nudge, not the whole list again.
    const sameTimesAlreadyShown =
      !requestedTime &&
      !currentMessageAnalysis.slots.dateText &&
      !currentMessageAnalysis.slots.guests &&
      optionsAlreadyShown(input.conversationHistory, timeLabels);

    return {
      action: "BOOKING_TIME_SELECTION_REQUIRED",
      reply: sameTimesAlreadyShown
        ? `I just need a time first: ${formatOrList(timeLabels)}?`
        : requestedTime
        ? `Good news, ${product.title} has room for ${effectiveSlots.guests} guests ${formatDatePhrase(
            effectiveSlots.dateText
          )}, and ${requestedTime.label} is free. Here are the available times:\n${formatTimeOptionsList(
            availability.timeOptions
          )}\n\nWant ${requestedTime.label}? Just say yes, or pick another.`
        : `Good news, ${product.title} has room for ${
            effectiveSlots.guests
          } guests ${formatDatePhrase(effectiveSlots.dateText)}. Here are the available times:\n${formatTimeOptionsList(
            availability.timeOptions
          )}\n\nWhich time works best? Nothing's booked yet.`,
      replySource: "DETERMINISTIC",
      bookingStatePatch: buildAvailabilityState({
        product,
        dateText: availabilityDateText,
        guests: effectiveSlots.guests,
        timeOptions: availability.timeOptions,
        ticketOptions: availability.ticketOptions,
        extraOptions: availability.extraOptions
      })
    };
  }

  if (input.bookingWriteEnabled === true && availability.ticketOptions && availability.ticketOptions.length > 1) {
    return {
      action: "BOOKING_TICKET_SELECTION_REQUIRED",
      reply: `Good news, ${product.title} has room for ${
        effectiveSlots.guests
      } guests ${formatAvailabilityDatePhrase(availabilityDateText)}.${onlyAvailableTimeSentence} There ${
        availability.remaining === 1 ? "is" : "are"
      } ${availability.remaining} seat${
        availability.remaining === 1 ? "" : "s"
      } available.\n\nTicket options:\n${formatTicketOptionsList(
        availability.ticketOptions,
        availability.currency
      )}\n\nWhich ticket suits? Just say "option 2" or "${optionExample(availability.ticketOptions)}". Nothing's booked yet.`,
      replySource: "DETERMINISTIC",
      bookingStatePatch: buildAvailabilityState({
        product,
        dateText: availabilityDateText,
        guests: effectiveSlots.guests,
        timeOptions: availability.timeOptions,
        ticketOptions: availability.ticketOptions,
        extraOptions: availability.extraOptions
      })
    };
  }

  const deterministicReply = `Good news, ${product.title} has room for ${
    effectiveSlots.guests
  } guests ${formatAvailabilityDatePhrase(availabilityDateText)}.${onlyAvailableTimeSentence} There ${
    availability.remaining === 1 ? "is" : "are"
  } ${availability.remaining} seat${
    availability.remaining === 1 ? "" : "s"
  } available at ${formatCurrencyAmount(
    availability.currency,
    availability.unitPriceCents
  )} per guest. Nothing's booked yet, so just say the word if it looks good.`;

  // Persists bookingStatus: "AVAILABILITY_CHECKED" (via buildAvailabilityState) even for this
  // simplest, single-price case with no time/ticket choices to make - without it, the capture flow
  // above (gated on real availability evidence in bookingMemory) could never unlock for this class
  // of product, since nothing else in this branch ever records that a real check happened. A later
  // "yes"/"book it" would otherwise re-run this same availability check forever instead of
  // progressing to contact collection.
  const availabilityCheckedState = buildAvailabilityState({
    product,
    dateText: availabilityDateText,
    guests: effectiveSlots.guests,
    timeOptions: availability.timeOptions,
    ticketOptions: availability.ticketOptions,
    extraOptions: availability.extraOptions
  });

  if (input.bookingWriteEnabled === true) {
    return {
      action: "AVAILABILITY_CHECKED",
      reply: deterministicReply,
      replySource: "DETERMINISTIC",
      bookingStatePatch: availabilityCheckedState
    };
  }

  return composeReplyResult({
    action: "AVAILABILITY_CHECKED",
    deterministicReply,
    requiredFacts: [
      product.title,
      `${effectiveSlots.guests} guests`,
      effectiveSlots.dateText ?? "",
      `${availability.remaining} seat${availability.remaining === 1 ? "" : "s"} available`,
      formatCurrencyAmount(availability.currency, availability.unitPriceCents)
    ],
    llmClient: input.llmClient,
    tenantContext: input.tenantContext,
    latestUserMessage: input.message,
    conversationHistory: input.conversationHistory,
    bookingStatePatch: availabilityCheckedState
  });
}
