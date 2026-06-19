import { bookingMemoryToContext, type BookingMemoryState } from "./booking-memory";
import { analyzeTravellerBookingMessage, composeBookingBrainReply } from "./booking-brain";
import { matchPmsProduct } from "./product-matcher";
import { composeAssistantReply, type AssistantLlmClient, type AssistantReplySource } from "@/core/llm/assistant-reply-composer";
import type { PmsAdapter, PmsProduct } from "@/core/pms/types";

export type BookingOrchestratorAction =
  | "AVAILABILITY_CHECKED"
  | "MANUAL_INQUIRY_REQUIRED"
  | "NEEDS_PRODUCT_SELECTION"
  | "NEEDS_MORE_DETAILS"
  | "HUMAN_HANDOFF"
  | "GENERAL_REPLY";

export interface BookingOrchestratorResult {
  action: BookingOrchestratorAction;
  reply: string;
  replySource: AssistantReplySource;
}

export interface HandleTravellerBookingMessageInput {
  message: string;
  priorTravellerMessages?: string[];
  bookingMemory?: BookingMemoryState | null;
  pmsAdapter: PmsAdapter;
  llmClient?: AssistantLlmClient | null;
}

function formatPrice(currency: string, unitPriceCents: number) {
  return currency + " " + (unitPriceCents / 100).toFixed(2);
}

async function composeReplyResult(input: {
  action: BookingOrchestratorAction;
  deterministicReply: string;
  requiredFacts?: string[];
  llmClient?: AssistantLlmClient | null;
}): Promise<BookingOrchestratorResult> {
  const composed = await composeAssistantReply({
    deterministicReply: input.deterministicReply,
    requiredFacts: input.requiredFacts,
    llmClient: input.llmClient
  });

  return {
    action: input.action,
    reply: composed.reply,
    replySource: composed.source
  };
}

function formatProductOptions(products: PmsProduct[]) {
  if (products.length === 1) {
    return products[0].title;
  }

  return `${products
    .slice(0, -1)
    .map((product) => product.title)
    .join(", ")} and ${products[products.length - 1].title}`;
}

export async function handleTravellerBookingMessage(
  input: HandleTravellerBookingMessageInput
): Promise<BookingOrchestratorResult> {
  const contextMessage = [
    bookingMemoryToContext(input.bookingMemory ?? null),
    ...(input.priorTravellerMessages ?? []),
    input.message
  ].join(" ");
  const analysis = analyzeTravellerBookingMessage(contextMessage);

  if (analysis.intent === "HUMAN_HANDOFF") {
    return composeReplyResult({
      action: "HUMAN_HANDOFF",
      deterministicReply: composeBookingBrainReply(analysis),
      llmClient: input.llmClient
    });
  }

  if (analysis.intent === "GENERAL_QUESTION") {
    return composeReplyResult({
      action: "GENERAL_REPLY",
      deterministicReply: composeBookingBrainReply(analysis),
      llmClient: input.llmClient
    });
  }

  if (analysis.missingSlots.includes("date") || analysis.missingSlots.includes("guests")) {
    return composeReplyResult({
      action: "NEEDS_MORE_DETAILS",
      deterministicReply: composeBookingBrainReply(analysis),
      llmClient: input.llmClient
    });
  }

  const products = await input.pmsAdapter.listProducts();
  const productMatch = matchPmsProduct(contextMessage, products);

  if (productMatch.status !== "MATCHED") {
    return composeReplyResult({
      action: "NEEDS_PRODUCT_SELECTION",
      deterministicReply: `Which tour should I check? Available options are ${formatProductOptions(productMatch.products)}.`,
      requiredFacts: productMatch.products.map((product) => product.title),
      llmClient: input.llmClient
    });
  }

  const product = productMatch.product;

  if (product.bookingMode === "MANUAL_INQUIRY") {
    return composeReplyResult({
      action: "MANUAL_INQUIRY_REQUIRED",
      deterministicReply: `${product.title} requires operator confirmation. I can collect the details, but I will not confirm availability automatically.`,
      requiredFacts: [product.title, "operator confirmation"],
      llmClient: input.llmClient
    });
  }

  const availability = await input.pmsAdapter.getAvailability({
    productId: product.externalProductId,
    date: analysis.slots.dateText ?? "",
    guests: analysis.slots.guests ?? 0
  });

  if (!availability.available) {
    return composeReplyResult({
      action: "AVAILABILITY_CHECKED",
      deterministicReply: `${product.title} is not available for ${analysis.slots.guests} guests on ${analysis.slots.dateText} according to PMS. I have not confirmed a booking.`,
      requiredFacts: [product.title, `${analysis.slots.guests} guests`, analysis.slots.dateText ?? "", "not available"],
      llmClient: input.llmClient
    });
  }

  const deterministicReply = `${product.title} is available for ${analysis.slots.guests} guests on ${
    analysis.slots.dateText
  }. PMS shows ${availability.remaining} spots remaining at ${formatPrice(
    availability.currency,
    availability.unitPriceCents
  )} per guest. I have not confirmed a booking yet.`;

  return composeReplyResult({
    action: "AVAILABILITY_CHECKED",
    deterministicReply,
    requiredFacts: [
      product.title,
      `${analysis.slots.guests} guests`,
      analysis.slots.dateText ?? "",
      `${availability.remaining} spots`,
      formatPrice(availability.currency, availability.unitPriceCents)
    ],
    llmClient: input.llmClient
  });
}
