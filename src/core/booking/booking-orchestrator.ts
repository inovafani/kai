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
import type { PmsAdapter, PmsProduct, PmsTicketOption, PmsTicketQuantity } from "@/core/pms/types";

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

function formatTicketOptions(options: PmsTicketOption[], currency: string) {
  return formatList(options.map((option) => `${option.label} (${formatPrice(currency, option.unitPriceCents)})`));
}

function formatTicketQuantities(quantities: PmsTicketQuantity[]) {
  return formatList(quantities.map((ticket) => `${ticket.quantity} ${ticket.optionLabel}`));
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

function parseTicketQuantities(message: string, options: PmsTicketOption[]) {
  const quantities: PmsTicketQuantity[] = [];
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

function ticketParticipantCount(quantities: PmsTicketQuantity[]) {
  return quantities.reduce((total, ticket) => {
    const multiplier = isFamilyTicket(ticket.optionLabel) ? 4 : /\b2\s*people\b/i.test(ticket.optionLabel) ? 2 : 1;
    return total + ticket.quantity * multiplier;
  }, 0);
}

function formatRecommendationReply(products: PmsProduct[], dateText: string | null) {
  const autoBookingProducts = products.filter((product) => product.bookingMode === "AUTO_BOOKING");
  const manualProducts = products.filter((product) => product.bookingMode === "MANUAL_INQUIRY");
  const datePrefix = dateText ? `For ${dateText}, ` : "";
  const firstWord = dateText ? "you" : "You";
  const manualNote =
    manualProducts.length > 0
      ? ` ${formatProductOptions(manualProducts)} needs operator confirmation.`
      : "";

  return `${datePrefix}${firstWord} can choose from ${formatProductOptions(products)}. I can check live availability for ${formatProductOptions(
    autoBookingProducts
  )}.${manualNote} Which one sounds closest to what you want?`;
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
    ...(memory.ticketOptions ? { ticketOptions: memory.ticketOptions } : {}),
    ...(memory.ticketQuantities ? { ticketQuantities: memory.ticketQuantities } : {})
  };
}

function buildAvailabilityState(input: {
  product: PmsProduct;
  dateText: string | null;
  guests: number | null;
  ticketOptions?: PmsTicketOption[] | null;
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
    ticketOptions: input.ticketOptions ?? null,
    ticketQuantities: null
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
    productHint: analysis.slots.productHint ?? contextAnalysis.slots.productHint ?? input.bookingMemory?.productTitle ?? null,
    dateText: currentMessageAnalysis.slots.dateText ?? contextAnalysis.slots.dateText ?? input.bookingMemory?.dateText ?? null,
    guests: currentMessageAnalysis.slots.guests ?? contextAnalysis.slots.guests ?? input.bookingMemory?.guests ?? null
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
  const ticketOptions = input.bookingMemory?.ticketOptions ?? [];
  if (ticketOptions.length > 1 && !input.bookingMemory?.ticketQuantities) {
    const parsedTicketQuantities = parseTicketQuantities(input.message, ticketOptions);

    if (parsedTicketQuantities.length > 0) {
      const participantCount = ticketParticipantCount(parsedTicketQuantities);

      if (input.bookingMemory?.guests && participantCount !== input.bookingMemory.guests) {
        return {
          action: "BOOKING_TICKET_SELECTION_REQUIRED",
          reply: `I counted ${participantCount} participant${
            participantCount === 1 ? "" : "s"
          } from that ticket mix, but we were checking ${input.bookingMemory.guests}. Please send the ticket mix again so it matches ${input.bookingMemory.guests} participants.`,
          replySource: "DETERMINISTIC"
        };
      }

      const ticketStatePatch: BookingFlowState = {
        productExternalId: input.bookingMemory?.productExternalId ?? null,
        productTitle: input.bookingMemory?.productTitle ?? null,
        dateText: input.bookingMemory?.dateText ?? null,
        guests: input.bookingMemory?.guests ?? participantCount,
        travellerName: input.bookingMemory?.travellerName ?? null,
        travellerEmail: input.bookingMemory?.travellerEmail ?? null,
        travellerPhone: input.bookingMemory?.travellerPhone ?? null,
        bookingStatus: "AVAILABILITY_CHECKED",
        confirmationSummary: null,
        externalBookingId: null,
        externalProvider: null,
        bookingError: null,
        ticketOptions,
        ticketQuantities: parsedTicketQuantities
      };

      return {
        action: "BOOKING_DETAILS_REQUIRED",
        reply: `Great. I have the ticket mix as ${formatTicketQuantities(parsedTicketQuantities)} for ${
          input.bookingMemory?.productTitle
        } ${input.bookingMemory?.dateText}. Please share your name, email, and phone number before I create the booking.`,
        replySource: "DETERMINISTIC",
        inquiryDraft: null,
        bookingStatePatch: ticketStatePatch
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
        reply: `Before I prepare the booking, please choose the ticket mix for ${
          input.bookingMemory?.guests
        } participant${input.bookingMemory?.guests === 1 ? "" : "s"}: ${formatTicketOptions(
          ticketOptions,
          "AUD"
        )}. For example, "2 adults and 1 child".`,
        replySource: "DETERMINISTIC"
      };
    }
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
          ...(input.bookingMemory?.ticketQuantities ? { ticketQuantities: input.bookingMemory.ticketQuantities } : {})
        });
        const ticketSummary = readyState.ticketQuantities?.length
          ? ` with ${formatTicketQuantities(readyState.ticketQuantities)}`
          : "";

        return {
          action: "BOOKING_READY_TO_CONFIRM",
          reply: `I have the details for ${readyState.productTitle} on ${readyState.dateText} for ${
            readyState.guests
          } guest${readyState.guests === 1 ? "" : "s"}${ticketSummary} under ${readyState.travellerName}, ${
            readyState.travellerEmail
          }, ${readyState.travellerPhone}. Please confirm: should I create this booking now?`,
          replySource: "DETERMINISTIC",
          bookingStatePatch: readyState
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
      reply: `I can help with that. Please share the ${missingSlots.join(", ")} so I can check safely.`,
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

  if (input.bookingWriteEnabled === true && availability.ticketOptions && availability.ticketOptions.length > 1) {
    return {
      action: "BOOKING_TICKET_SELECTION_REQUIRED",
      reply: `Good news, ${product.title} has availability for ${
        effectiveSlots.guests
      } guests ${formatDatePhrase(effectiveSlots.dateText)}. There are ${
        availability.remaining
      } spots left. Ticket options are ${formatTicketOptions(
        availability.ticketOptions,
        availability.currency
      )}. Please tell me the ticket mix, for example "2 adults and 1 child". I have not confirmed anything yet.`,
      replySource: "DETERMINISTIC",
      bookingStatePatch: buildAvailabilityState({
        product,
        dateText: effectiveSlots.dateText,
        guests: effectiveSlots.guests,
        ticketOptions: availability.ticketOptions
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
