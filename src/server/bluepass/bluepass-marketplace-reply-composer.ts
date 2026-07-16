import {
  composeAssistantReply,
  type AssistantConversationMessage,
  type AssistantLlmClient
} from "@/core/llm/assistant-reply-composer";

type BluePassMarketplaceComposerResult = {
  reply: string;
  source: "DETERMINISTIC" | "LLM";
};

type BluePassMarketplaceResultLike = {
  replyMode?: "CONCIERGE" | "ACTION";
  assistantContent: string;
  bluepassMatches: Array<{ name?: string | null; region?: string | null }>;
  bluepassInquiry?: {
    selectedYachtName?: string | null;
    operatorName?: string | null;
    destination?: string | null;
    dateWindow?: string | null;
    guests?: number | null;
  } | null;
};

export async function composeBluePassMarketplaceAssistantReply(input: {
  deterministicReply: string;
  latestMessage: string;
  marketplaceResult: BluePassMarketplaceResultLike;
  conversationHistory: AssistantConversationMessage[];
  llmClient?: AssistantLlmClient | null;
}): Promise<BluePassMarketplaceComposerResult> {
  const conciergeMode = input.marketplaceResult.replyMode === "CONCIERGE";
  const productTitles = buildMarketplaceProductTitles(input.marketplaceResult);
  const requiredFacts = conciergeMode ? [] : buildMarketplaceRequiredFacts(input.marketplaceResult, input.deterministicReply);

  return composeAssistantReply({
    deterministicReply: input.deterministicReply,
    requiredFacts,
    latestUserMessage: input.latestMessage,
    conversationHistory: input.conversationHistory,
    llmClient: input.llmClient ?? null,
    tenantContext: {
      tenantName: "BluePass",
      brandVoice:
        "Warm, natural marine travel concierge. Helpful like a human travel advisor, but concise and honest about operator confirmation.",
      pmsProvider: "BluePass marketplace catalog and operator network",
      responseGuardrails: [
        conciergeMode
          ? "For discovery and travel inspiration, answer the traveller naturally first; do not force name, email, or inquiry collection until they clearly want to send an operator inquiry."
          : "For transactional inquiry replies, preserve all operational facts exactly.",
        conciergeMode
          ? "Act as a knowledgeable Indonesia travel concierge: freely use your own general travel knowledge to answer questions about any destination, activity, culture, or logistics, even outside the BluePass catalog, as long as you stay honest about what BluePass has actually vetted."
          : null,
        "Do not confirm live availability, final price, payment, or booking before operator confirmation.",
        "Do not invent operator responses, payment links, dates, or live availability.",
        "If the traveller asks general questions, answer helpfully before asking for booking details."
      ].filter((line): line is string => line !== null),
      productTitles,
      knownRegions: ["Komodo", "Raja Ampat"]
    }
  });
}

export function buildMarketplaceProductTitles(result: BluePassMarketplaceResultLike) {
  return Array.from(
    new Set(
      [
        result.bluepassInquiry?.selectedYachtName,
        result.bluepassInquiry?.operatorName,
        ...result.bluepassMatches.map((match) => match.name)
      ].filter((value): value is string => Boolean(value))
    )
  );
}

export function buildMarketplaceRequiredFacts(result: BluePassMarketplaceResultLike, deterministicReply: string) {
  const inquiry = result.bluepassInquiry;
  const facts = [
    inquiry?.selectedYachtName,
    inquiry?.destination,
    inquiry?.dateWindow,
    inquiry?.guests ? `${inquiry.guests}` : null,
    ...result.bluepassMatches.map((match) => match.name),
    ...extractBluePassDeterministicFacts(deterministicReply)
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(facts));
}

function extractBluePassDeterministicFacts(reply: string) {
  const facts: string[] = [];

  for (const match of reply.matchAll(/^\s*\d+\.\s+([A-Z][^-:\n]+?)\s+-/gm)) {
    facts.push(match[1].trim());
  }

  for (const pattern of [
    /\bfor\s+([A-Z][A-Za-z0-9' ]+?)\s+in\s+(?:Komodo|Raja Ampat)\b/g,
    /\bGreat choice\s+-\s+([A-Z][A-Za-z0-9' ]+?)\s+is\b/g,
    /^([A-Z][A-Za-z0-9' ]+?)\s+is\s+(?:a|an)\s+/gm
  ]) {
    for (const match of reply.matchAll(pattern)) {
      facts.push(match[1].trim());
    }
  }

  for (const match of reply.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    facts.push(match[0]);
  }

  for (const match of reply.matchAll(/\b(?:\+?62|0)\d{8,14}\b/g)) {
    facts.push(match[0]);
  }

  const contactMatch = reply.match(/\bContact details:\s*([^,\n.]+),/i);
  if (contactMatch) {
    facts.push(contactMatch[1].trim());
  }

  const tripMatch = reply.match(/\btrip details as\s+([^.\n]+)\./i);
  if (tripMatch) {
    const tripDetails = tripMatch[1];
    const dateMatch = tripDetails.match(/\b\d{1,2}\s+[A-Z][a-z]+(?:\s+\d{4})?\b/);
    const guestMatch = tripDetails.match(/\b\d{1,3}\s+guests?\b/i);

    if (dateMatch) facts.push(dateMatch[0]);
    if (guestMatch) facts.push(guestMatch[0]);
  }

  return facts;
}
