import { bookingMemoryToContext, type BookingMemoryState } from "./booking-memory";
import { analyzeTravellerBookingMessage, composeBookingBrainReply } from "./booking-brain";
import {
  composeBookingCaptureReply,
  evaluateBookingCapture,
  type BookingCaptureDetails
} from "./booking-capture";
import {
  beginExternalBooking,
  captureBookingDetails,
  markBookingReadyToConfirm,
  markExternalBookingConfirmed,
  markExternalBookingFailed,
  type BookingFlowState
} from "./booking-state-machine";
import { matchPmsProduct } from "./product-matcher";
import { composeAssistantReply, type AssistantLlmClient, type AssistantReplySource, type AssistantTenantContext } from "@/core/llm/assistant-reply-composer";
import type {
  PmsAdapter,
  PmsExtraOption,
  PmsExtraQuantity,
  PmsProduct,
  PmsTicketOption,
  PmsTicketQuantity,
  PmsTimeOption
} from "@/core/pms/types";

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

export interface BookingOrchestratorResult {
  action: BookingOrchestratorAction;
  reply: string;
  replySource: AssistantReplySource;
  inquiryDraft?: BookingCaptureDetails | null;
  bookingStatePatch?: BookingFlowState | null;
}

export interface HandleTravellerBookingMessageInput {
  message: string;
  priorTravellerMessages?: string[];
  bookingMemory?: BookingMemoryState | null;
  pmsAdapter: PmsAdapter;
  bookingWriteEnabled?: boolean;
  allowUnpaidExternalBooking?: boolean;
  llmClient?: AssistantLlmClient | null;
  tenantContext?: AssistantTenantContext | null;
}

function formatPrice(currency: string, unitPriceCents: number) {
  return currency + " " + (unitPriceCents / 100).toFixed(2);
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
}): Promise<BookingOrchestratorResult> {
  const composed = await composeAssistantReply({
    deterministicReply: input.deterministicReply,
    requiredFacts: input.requiredFacts,
    tenantContext: input.tenantContext,
    llmClient: input.llmClient
  });

  return {
    action: input.action,
    reply: composed.reply,
    replySource: composed.source
  };
}

function formatProductOptions(products: Pick<PmsProduct, "title">[]) {
  if (products.length === 1) {
    return products[0].title;
  }

  return formatList(products.map((product) => product.title));
}

function formatProductOptionsList(products: PmsProduct[]) {
  return formatNumberedList(
    products.map((product) =>
      `${product.title} - ${product.bookingMode === "AUTO_BOOKING" ? "live availability" : "operator confirmation required"}`
    )
  );
}

function formatTicketLabelForReply(label: string) {
  return label.replace(/^"+\s*/, "").replace(/\s*"+$/g, "");
}

function formatTicketOptions(options: PmsTicketOption[], currency: string) {
  return formatList(
    options.map((option) => `${formatTicketLabelForReply(option.label)} (${formatPrice(currency, option.unitPriceCents)})`)
  );
}

function formatTicketOptionsList(options: PmsTicketOption[], currency: string) {
  return formatNumberedList(
    options.map((option) => `${formatTicketLabelForReply(option.label)} - ${formatPrice(currency, option.unitPriceCents)}`)
  );
}

function formatTicketQuantities(quantities: PmsTicketQuantity[]) {
  return formatList(quantities.map((ticket) => `${ticket.quantity} ${formatTicketLabelForReply(ticket.optionLabel)}`));
}

function formatExtraOptionsList(options: PmsExtraOption[], currency: string) {
  return formatNumberedList(
    options.map((option) => `${formatTicketLabelForReply(option.label)} - ${formatPrice(currency, option.unitPriceCents)}`)
  );
}

function formatExtraQuantities(quantities: PmsExtraQuantity[]) {
  if (quantities.length === 0) return "no extras";

  return formatList(quantities.map((extra) => `${extra.quantity} ${formatTicketLabelForReply(extra.optionLabel)}`));
}

function formatTimeOptionsList(options: PmsTimeOption[]) {
  return formatNumberedList(
    options.map((option) => `${option.label} - ${option.remaining} spot${option.remaining === 1 ? "" : "s"}`)
  );
}

const knownRezdyCheckoutUrls: Record<string, string> = {
  "boattime-whale-escape": "https://boattimeyachtcharters.rezdy.com/services/431872",
  "gold coast whale escape": "https://boattimeyachtcharters.rezdy.com/services/431872"
};

const knownRezdyProductCodes: Record<string, string> = {
  "boattime-whale-escape": "LWWVE",
  "gold coast whale escape": "LWWVE"
};

const knownBookingFormUrls: Record<string, string> = {
  "boattime-whale-escape": "https://www.boattimeyachtcharters.com/cruise-tickets-luxury-whale-watching#book",
  "gold coast whale escape": "https://www.boattimeyachtcharters.com/cruise-tickets-luxury-whale-watching#book"
};

function isLocalOrDemoUrl(value: string) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname) || url.pathname.startsWith("/demo/");
  } catch {
    return true;
  }
}

function isRezdyBookingUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.hostname.endsWith(".rezdy.com") &&
      (url.pathname.startsWith("/services/") || url.pathname.startsWith("/view/") || url.pathname === "/book")
    );
  } catch {
    return false;
  }
}

function serviceIdFromRezdyUrl(value: string) {
  try {
    return new URL(value).pathname.match(/^\/services\/(\d+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function rezdyHostFromUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname.endsWith(".rezdy.com") ? url.hostname : null;
  } catch {
    return null;
  }
}

function withRezdyCheckoutSessionParams(baseUrl: string, timeOption: PmsTimeOption | null) {
  if (!timeOption?.checkoutItemKey && !timeOption?.checkoutSessionId) return baseUrl;

  try {
    const url = new URL(baseUrl);
    const serviceId = serviceIdFromRezdyUrl(baseUrl);
    const itemKey =
      timeOption.checkoutItemKey ??
      (serviceId && timeOption.checkoutSessionId ? `item-${serviceId}-${timeOption.checkoutSessionId}` : null);

    if (!itemKey) return baseUrl;

    url.searchParams.set("itemKey", itemKey);
    url.searchParams.set("useTransparentSessions", "1");

    return url.toString();
  } catch {
    return baseUrl;
  }
}

function resolveCheckoutUrl(input: {
  product: PmsProduct;
  provider: PmsAdapter["provider"];
  bookingState: BookingFlowState;
}) {
  const productUrl = input.product.productUrl?.trim() ?? "";
  const productKey = input.product.externalProductId.toLowerCase();
  const titleKey = input.product.title.toLowerCase();
  const mappedRezdyUrl = knownRezdyCheckoutUrls[productKey] ?? knownRezdyCheckoutUrls[titleKey] ?? null;
  const mappedProductCode = knownRezdyProductCodes[productKey] ?? knownRezdyProductCodes[titleKey] ?? null;
  const mappedBookingFormUrl = knownBookingFormUrls[productKey] ?? knownBookingFormUrls[titleKey] ?? null;
  const usableProductUrl =
    productUrl && !isLocalOrDemoUrl(productUrl) && isRezdyBookingUrl(productUrl) ? productUrl : null;
  const usableWebsiteUrl =
    productUrl && !isLocalOrDemoUrl(productUrl) && !isRezdyBookingUrl(productUrl) ? productUrl : null;
  const selectedTime = selectedTimeOption(input.bookingState.dateText, input.bookingState.timeOptions ?? []);
  const serviceCheckoutUrl = usableProductUrl ?? mappedRezdyUrl;

  if (selectedTime?.checkoutItemKey || selectedTime?.checkoutSessionId) {
    return serviceCheckoutUrl ? withRezdyCheckoutSessionParams(serviceCheckoutUrl, selectedTime) : null;
  }

  const rezdyHost = rezdyHostFromUrl(usableProductUrl ?? mappedRezdyUrl ?? "") ?? "boattimeyachtcharters.rezdy.com";
  const productCode =
    mappedProductCode ??
    (input.provider === "REZDY" && /^[A-Z0-9]{4,}$/i.test(input.product.externalProductId)
      ? input.product.externalProductId
      : null);

  if (mappedBookingFormUrl ?? usableWebsiteUrl) {
    return mappedBookingFormUrl ?? usableWebsiteUrl;
  }

  if (productCode) {
    return `https://${rezdyHost}/`;
  }

  return serviceCheckoutUrl ?? null;
}

function isDirectRezdyCheckoutHandoff(value: string) {
  try {
    const url = new URL(value);
    return url.hostname.endsWith(".rezdy.com") && url.searchParams.has("itemKey");
  } catch {
    return false;
  }
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
    normalizedMessage.match(/#\s*(\d{1,2})\b/);
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
    normalizedMessage.match(/#\s*(\d{1,2})\b/);

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

function composeMissingDetailsReply(input: {
  missingSlots: ("product" | "date" | "guests")[];
  productTitle: string | null;
  dateText: string | null;
  guests: number | null;
}) {
  if (input.missingSlots.length === 1 && input.missingSlots[0] === "guests" && input.productTitle && input.dateText) {
    return `I have ${input.productTitle} for ${input.dateText}. Please share the number of guests so I can check safely.`;
  }

  if (input.missingSlots.length === 1 && input.missingSlots[0] === "date" && input.productTitle && input.guests) {
    return `I have ${input.productTitle} for ${input.guests} guest${
      input.guests === 1 ? "" : "s"
    }. Please share the date so I can check safely.`;
  }

  return `I can help with that. Please share the ${input.missingSlots.join(", ")} so I can check safely.`;
}

function formatRecommendationReply(products: PmsProduct[], dateText: string | null) {
  const datePrefix = dateText ? `For ${dateText}, ` : "";
  const firstWord = dateText ? "you" : "You";

  return `${datePrefix}${firstWord} can choose from:\n${formatProductOptionsList(
    products
  )}\n\nWhich one sounds closest to what you want?`;
}

function lowerFirstLetter(value: string) {
  return value.length === 0 ? value : value[0].toLowerCase() + value.slice(1);
}

function formatProductInfoReply(product: PmsProduct) {
  const description = product.description ? ` is a ${lowerFirstLetter(product.description)}` : "";
  const linkSentence = product.productUrl
    ? ` You can see the product page here: ${product.productUrl}.`
    : " I do not have a product page link for it yet.";

  return `${product.title}${description}.${linkSentence} If you like it, tell me your date and group size and I can check availability.`;
}

function formatDatePhrase(dateText: string | null) {
  if (!dateText) {
    return "that date";
  }

  return ["today", "tomorrow", "tonight"].includes(dateText.toLowerCase()) ? dateText : `on ${dateText}`;
}

function formatDateAndTime(dateText: string | null) {
  if (!dateText) return "that date";

  const match = dateText.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):\d{2}$/);
  if (!match) return formatDatePhrase(dateText);

  const hour24 = Number(match[2]);
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;

  return `on ${match[1]} at ${hour12}:${match[3]} ${period}`;
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
  const timeMatch = compact.match(/^(\d{1,2})(?::?00)?(am|pm)$/);

  if (timeMatch) {
    aliases.add(`${timeMatch[1]}${timeMatch[2]}`);
    aliases.add(`${timeMatch[1]}:00${timeMatch[2]}`);
    aliases.add(`${timeMatch[1]}:00 ${timeMatch[2]}`);
  }

  return [...aliases];
}

function parseSelectedTimeOption(message: string, options: PmsTimeOption[]) {
  const normalizedMessage = normalizeTimeSelectionText(message);
  const compactMessage = normalizedMessage.replace(/\s+/g, "");
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

export async function handleTravellerBookingMessage(
  input: HandleTravellerBookingMessageInput
): Promise<BookingOrchestratorResult> {
  if (
    input.bookingWriteEnabled === true &&
    input.bookingMemory?.bookingStatus === "READY_TO_CONFIRM" &&
    isBookingConfirmationMessage(input.message)
  ) {
    const readyState = bookingMemoryToFlowState(input.bookingMemory);

    if (!readyState) {
      return {
        action: "BOOKING_FAILED",
        reply: "I cannot create the booking yet because the booking details are incomplete.",
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
          "I have saved this booking request for the operator. Kai has not collected payment yet, so I will not create an unpaid confirmed booking in the PMS automatically.",
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
            "I could not confirm this booking in the PMS, so I saved the request in admin as a fallback. The booking is not confirmed yet.",
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
        reply: `Your booking is confirmed. Confirmation reference ${booking.externalBookingId} belongs to ${
          confirmedState.productTitle
        } on ${confirmedState.dateText} for ${confirmedState.guests} guest${
          confirmedState.guests === 1 ? "" : "s"
        }. I have not collected payment in Kai.`,
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
          "I could not confirm this booking in the PMS, so I saved the request in admin as a fallback. The booking is not confirmed yet.",
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
  const currentMessageAnalysis = analyzeTravellerBookingMessage(input.message);
  const contextAnalysis = analyzeTravellerBookingMessage(contextMessage);
  const analysis =
    currentMessageAnalysis.intent === "GENERAL_QUESTION"
      ? contextAnalysis
      : currentMessageAnalysis;
  const effectiveSlots = {
    productHint: currentMessageAnalysis.slots.productHint ?? input.bookingMemory?.productTitle ?? contextAnalysis.slots.productHint ?? null,
    dateText: currentMessageAnalysis.slots.dateText ?? input.bookingMemory?.dateText ?? contextAnalysis.slots.dateText ?? null,
    guests: currentMessageAnalysis.slots.guests ?? input.bookingMemory?.guests ?? contextAnalysis.slots.guests ?? null
  };
  const missingSlots = [
    effectiveSlots.productHint ? null : "product",
    effectiveSlots.dateText ? null : "date",
    effectiveSlots.guests ? null : "guests"
  ].filter((slot): slot is "product" | "date" | "guests" => Boolean(slot));
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
  const shouldHandleCapture =
    capture.active &&
    (capture.ready ||
      (currentMessageAnalysis.intent !== "CHECK_AVAILABILITY" && analysis.intent !== "CHECK_AVAILABILITY"));
  const timeOptions = input.bookingMemory?.timeOptions ?? [];
  const rememberedTime = selectedTimeOption(input.bookingMemory?.dateText, timeOptions);

  if (timeOptions.length > 1 && !rememberedTime) {
    const parsedTime = parseSelectedTimeOption(input.message, timeOptions);

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
        ticketQuantities: input.bookingMemory?.ticketQuantities ?? null
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
            "AUD"
          )}\n\nWhich ticket option should I use? You can say "option 2" or "1 x 2 people".`,
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
        }. Please share your name, email, and phone number so I can prepare the checkout handoff.`,
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
        reply: `Please choose one available time:\n${formatTimeOptionsList(timeOptions)}\n\nI have not confirmed anything yet.`,
        replySource: "DETERMINISTIC"
      };
    }
  }

  const ticketOptions = input.bookingMemory?.ticketOptions ?? [];
  if (ticketOptions.length > 1 && !input.bookingMemory?.ticketQuantities) {
    const correctedTime =
      timeOptions.length > 1 ? parseSelectedTimeOption(input.message, timeOptions) : null;
    const dateTextForTicketSelection =
      correctedTime?.startTimeLocal ?? input.bookingMemory?.dateText ?? null;
    const parsedTicketQuantities = parseTicketQuantities(input.message, ticketOptions, input.bookingMemory?.guests);

    if (parsedTicketQuantities.length > 0) {
      const participantCount = ticketParticipantCount(parsedTicketQuantities);

      if (input.bookingMemory?.guests && participantCount !== input.bookingMemory.guests) {
        return {
          action: "BOOKING_TICKET_SELECTION_REQUIRED",
          reply: `I counted ${participantCount} participant${
            participantCount === 1 ? "" : "s"
          } from that ticket selection, but we were checking ${
            input.bookingMemory.guests
          }. Please choose a ticket option and quantity that matches ${input.bookingMemory.guests} participants.`,
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
            "AUD"
          )}\n\nWould you like to add any extras? You can say "no extras" or "1 x Corona Bucket".`,
          replySource: "DETERMINISTIC",
          bookingStatePatch: ticketStatePatch
        };
      }

      return {
        action: "BOOKING_DETAILS_REQUIRED",
        reply: `Got it. I have ${input.bookingMemory?.productTitle} ${formatDateAndTime(
          dateTextForTicketSelection
        )} for ${input.bookingMemory?.guests ?? participantCount} guest${
          (input.bookingMemory?.guests ?? participantCount) === 1 ? "" : "s"
        } with ${formatTicketQuantities(parsedTicketQuantities)}. Please share your name, email, and phone number so I can prepare the secure payment step.`,
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
        ticketQuantities: null
      };

      return {
        action: "BOOKING_TICKET_SELECTION_REQUIRED",
        reply: `Got it, I have ${input.bookingMemory?.productTitle} ${formatDateAndTime(
          correctedTime.startTimeLocal
        )} for ${input.bookingMemory?.guests} guest${
          input.bookingMemory?.guests === 1 ? "" : "s"
        }.\n\nTicket options:\n${formatTicketOptionsList(
          ticketOptions,
          "AUD"
        )}\n\nPlease choose one ticket option and quantity.`,
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
        reply: `Before I prepare the booking, please choose one ticket option and quantity for ${
          input.bookingMemory?.guests
        } participant${input.bookingMemory?.guests === 1 ? "" : "s"}:\n${formatTicketOptionsList(
          ticketOptions,
          "AUD"
        )}\n\nFor example, "1 x 2 people" or "2 adults".`,
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
          ? "No extras added."
          : `Added ${formatExtraQuantities(parsedExtraQuantities)}.`;

      return {
        action: "BOOKING_DETAILS_REQUIRED",
        reply: `${extraReplyPrefix} Please share your name, email, and phone number so I can prepare the secure payment step.`,
        replySource: "DETERMINISTIC",
        bookingStatePatch: extraStatePatch
      };
    }

    return {
      action: "BOOKING_EXTRAS_SELECTION_REQUIRED",
      reply: `Optional extras:\n${formatExtraOptionsList(
        extraOptions,
        "AUD"
      )}\n\nWould you like to add any extras? You can say "no extras" or "1 x Corona Bucket".`,
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
        reply: `Of course. Here is the page for ${product.title}: ${product.productUrl}. Take a look, and if it feels right, just tell me you want to continue.`,
        replySource: "DETERMINISTIC"
      };
    }

    if (product) {
      return {
        action: "PRODUCT_LINK",
        reply: `I do not have a product page link for ${product.title} yet, but I can help with availability, pricing, and booking questions here.`,
        replySource: "DETERMINISTIC"
      };
    }
  }

  if (shouldHandleCapture) {
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
          reply: `Nice. To prepare ${capture.details.productTitle} for ${capture.details.guests} guest${
            capture.details.guests === 1 ? "" : "s"
          } ${formatDatePhrase(
            capture.details.dateText
          )}, I just need your name, email, and phone number. After that I will show you the details once more before creating the booking.`,
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
          reply: `Thanks, I have the details for ${capture.details.productTitle} on ${
            capture.details.dateText
          } for ${capture.details.guests} guest${
            capture.details.guests === 1 ? "" : "s"
          }. Booking confirmation is not enabled for this tenant yet, so I will send this to the operator for confirmation.`,
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

        return {
          action: "BOOKING_PAYMENT_REQUIRED",
          reply: `Thanks, I have everything for ${readyState.productTitle} ${formatDateAndTime(
            readyState.dateText
          )} for ${
            readyState.guests
          } guest${readyState.guests === 1 ? "" : "s"}${ticketSummary}${extraSummary} under ${readyState.travellerName}, ${
            readyState.travellerEmail
          }, ${
            readyState.travellerPhone
          }.\n\nUse the secure payment panel below when you are ready. I cannot take card details in chat.\n\nFor now, I saved this as a lead for the operator.`,
          replySource: "DETERMINISTIC",
          inquiryDraft: capture.details,
          bookingStatePatch: paymentState
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

  if (analysis.intent === "HUMAN_HANDOFF") {
    return composeReplyResult({
      action: "HUMAN_HANDOFF",
      deterministicReply: composeBookingBrainReply(analysis),
      llmClient: input.llmClient,
      tenantContext: input.tenantContext
    });
  }

  if (analysis.intent === "PRODUCT_RECOMMENDATION") {
    const products = await input.pmsAdapter.listProducts();

    if (analysis.slots.productHint) {
      const productMatch = matchPmsProduct(analysis.slots.productHint, products);

      if (productMatch.status === "MATCHED") {
        return {
          action: "PRODUCT_LINK",
          reply: formatProductInfoReply(productMatch.product),
          replySource: "DETERMINISTIC"
        };
      }
    }

    return {
      action: "PRODUCT_RECOMMENDATION",
      reply: formatRecommendationReply(products, currentMessageAnalysis.slots.dateText),
      replySource: "DETERMINISTIC"
    };
  }

  if (analysis.intent === "GENERAL_QUESTION") {
    return composeReplyResult({
      action: "GENERAL_REPLY",
      deterministicReply: composeBookingBrainReply(analysis),
      llmClient: input.llmClient,
      tenantContext: input.tenantContext
    });
  }

  if (missingSlots.includes("date") || missingSlots.includes("guests")) {
    return {
      action: "NEEDS_MORE_DETAILS",
      reply: composeMissingDetailsReply({
        missingSlots,
        productTitle: effectiveSlots.productHint,
        dateText: effectiveSlots.dateText,
        guests: effectiveSlots.guests
      }),
      replySource: "DETERMINISTIC"
    };
  }

  const products = await input.pmsAdapter.listProducts();
  const productMatch = matchPmsProduct(contextMessage, products);

  if (productMatch.status !== "MATCHED") {
    return composeReplyResult({
      action: "NEEDS_PRODUCT_SELECTION",
      deterministicReply: `Which tour should I check? Available options are ${formatProductOptions(productMatch.products)}.`,
      requiredFacts: productMatch.products.map((product) => product.title),
      llmClient: input.llmClient,
      tenantContext: {
        ...(input.tenantContext ?? { tenantName: "Unknown tenant" }),
        productTitles: productMatch.products.map((product) => product.title)
      }
    });
  }

  const product = productMatch.product;

  if (product.bookingMode === "MANUAL_INQUIRY") {
    return {
      action: "MANUAL_INQUIRY_REQUIRED",
      reply: `${product.title} requires operator confirmation. I can collect the details, but I will not confirm availability automatically.`,
      replySource: "DETERMINISTIC"
    };
  }

  const availability = await input.pmsAdapter.getAvailability({
    productId: product.externalProductId,
    date: effectiveSlots.dateText ?? "",
    guests: effectiveSlots.guests ?? 0
  });

  if (!availability.available) {
    return composeReplyResult({
      action: "AVAILABILITY_CHECKED",
      deterministicReply: `${product.title} is not available for ${effectiveSlots.guests} guests on ${effectiveSlots.dateText} according to PMS. I have not confirmed a booking.`,
      requiredFacts: [product.title, `${effectiveSlots.guests} guests`, effectiveSlots.dateText ?? "", "not available"],
      llmClient: input.llmClient,
      tenantContext: input.tenantContext
    });
  }

  if (input.bookingWriteEnabled === true && availability.timeOptions && availability.timeOptions.length > 1) {
    return {
      action: "BOOKING_TIME_SELECTION_REQUIRED",
      reply: `${product.title} is available for ${
        effectiveSlots.guests
      } guests ${formatDatePhrase(effectiveSlots.dateText)}. I found these times:\n${formatTimeOptionsList(
        availability.timeOptions
      )}\n\nWhich time works best? Nothing is booked yet.`,
      replySource: "DETERMINISTIC",
      bookingStatePatch: buildAvailabilityState({
        product,
        dateText: effectiveSlots.dateText,
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
      reply: `${product.title} is available for ${
        effectiveSlots.guests
      } guests ${formatDatePhrase(effectiveSlots.dateText)}. There are ${
        availability.remaining
      } spots left.\n\nTicket options:\n${formatTicketOptionsList(
        availability.ticketOptions,
        availability.currency
      )}\n\nWhich ticket option should I use? You can say "option 2" or "1 x 2 people". Nothing is booked yet.`,
      replySource: "DETERMINISTIC",
      bookingStatePatch: buildAvailabilityState({
        product,
        dateText: effectiveSlots.dateText,
        guests: effectiveSlots.guests,
        timeOptions: availability.timeOptions,
        ticketOptions: availability.ticketOptions,
        extraOptions: availability.extraOptions
      })
    };
  }

  const deterministicReply = `Good news, ${product.title} has availability for ${
    effectiveSlots.guests
  } guests ${formatDatePhrase(effectiveSlots.dateText)}. There are ${availability.remaining} spots left at ${formatPrice(
    availability.currency,
    availability.unitPriceCents
  )} per guest. I have not confirmed anything yet, but I can help you continue if this looks good.`;

  if (input.bookingWriteEnabled === true) {
    return {
      action: "AVAILABILITY_CHECKED",
      reply: deterministicReply,
      replySource: "DETERMINISTIC"
    };
  }

  return composeReplyResult({
    action: "AVAILABILITY_CHECKED",
    deterministicReply,
    requiredFacts: [
      product.title,
      `${effectiveSlots.guests} guests`,
      effectiveSlots.dateText ?? "",
      `${availability.remaining} spots`,
      formatPrice(availability.currency, availability.unitPriceCents)
    ],
    llmClient: input.llmClient,
    tenantContext: input.tenantContext
  });
}
