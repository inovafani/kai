export type AssistantReplySource = "DETERMINISTIC" | "LLM";

export interface AssistantReplyComposerResult {
  reply: string;
  source: AssistantReplySource;
}

export interface AssistantConversationMessage {
  role: "traveller" | "assistant";
  content: string;
}

export interface AssistantTenantContext {
  tenantName: string;
  brandVoice?: string | null;
  pmsProvider?: string | null;
  responseGuardrails?: string[];
  productTitles?: string[];
  /** Regions/destinations this tenant genuinely operates in - mentioning one is never treated as
   * an invented product, even without also naming a specific catalog item. */
  knownRegions?: string[];
  /** One-line grounding on what operator knowledge exists - context only, never the load-bearing
   *  answer (that rides deterministicReply). */
  knowledgeSummary?: string | null;
  systemPrompt?: string | null;
}

export interface AssistantLlmClient {
  composeReply(input: {
    deterministicReply: string;
    requiredFacts: string[];
    tenantContext?: AssistantTenantContext | null;
    tenantSystemPrompt?: string;
    latestUserMessage?: string | null;
    conversationHistory?: AssistantConversationMessage[];
  }): Promise<string>;
}

export interface ComposeAssistantReplyInput {
  deterministicReply: string;
  requiredFacts?: string[];
  tenantContext?: AssistantTenantContext | null;
  llmClient?: AssistantLlmClient | null;
  latestUserMessage?: string | null;
  conversationHistory?: AssistantConversationMessage[];
}

const unsafeConfirmationPatterns = [
  /\bbooking is confirmed\b/i,
  /\bconfirmed for you\b/i,
  /\byour booking is complete\b/i,
  /\breservation is confirmed\b/i
];

function includesFact(reply: string, fact: string) {
  return reply.toLowerCase().includes(fact.toLowerCase());
}

function isSafeRewrite(reply: string, requiredFacts: string[]) {
  const includesUnsafeConfirmation = unsafeConfirmationPatterns.some((pattern) => pattern.test(reply));

  if (includesUnsafeConfirmation) {
    return false;
  }

  return requiredFacts.every((fact) => includesFact(reply, fact));
}

function respectsTenantProductContext(reply: string, tenantContext?: AssistantTenantContext | null) {
  const productTitles = tenantContext?.productTitles ?? [];
  if (productTitles.length === 0) {
    return true;
  }

  const lowerReply = reply.toLowerCase();
  const knownRegions = (tenantContext?.knownRegions ?? []).map((region) => region.toLowerCase());
  const knownProductMentioned = productTitles.some((title) => lowerReply.includes(title.toLowerCase()));
  // "Komodo" is used here as the one hardcoded example of an out-of-scope destination (this guard
  // was written against a real bug: an LLM rewrite claiming a Gold Coast tenant offered "Komodo
  // tours"). That example is backwards for a tenant whose real scope IS Komodo/Raja Ampat, so a
  // tenant's own knownRegions always wins over this hardcoded check.
  const mentionsKomodo = /\bkomodo\b/i.test(reply) && !knownRegions.includes("komodo");

  if (mentionsKomodo && !knownProductMentioned && !productTitles.some((title) => /\bkomodo\b/i.test(title))) {
    return false;
  }

  return true;
}

function removeRepeatedGreeting(reply: string) {
  return reply
    .replace(
      /^(?:"?)(hello|hi|hey|good day|good morning|good afternoon|good evening)[,.!]\s*(i'?m\s+kai,?\s*)?(your\s+booking\s+assistant[,.]?\s*)?/i,
      ""
    )
    .trim()
    .replace(/^["'\s]+/, "");
}

export function buildTenantSystemPrompt(tenantContext?: AssistantTenantContext | null) {
  if (tenantContext?.systemPrompt?.trim()) {
    return tenantContext.systemPrompt.trim();
  }

  const tenantName = tenantContext?.tenantName ?? "this business";
  const brandVoice =
    tenantContext?.brandVoice?.trim() ||
    "Warm, quick, straight - the sharpest guide on the dock: genuinely helpful, concrete, never salesy.";
  const pmsProvider = tenantContext?.pmsProvider ?? "the configured PMS";
  const guardrails = tenantContext?.responseGuardrails?.filter(Boolean) ?? [];
  const products = tenantContext?.productTitles?.filter(Boolean) ?? [];
  const knowledgeSummary = tenantContext?.knowledgeSummary?.trim();

  return [
    `You are Kai for ${tenantName}.`,
    `Use this tenant voice: ${brandVoice}`,
    "Answer first, then colour: the opening sentence does the work. Concrete details beat adjectives.",
    "No corporate filler, no exclamation stacking, no emojis. Never re-ask for a detail the user already gave.",
    `Ground answers in ${pmsProvider} data and the tenant business pack.`,
    knowledgeSummary ? knowledgeSummary : null,
    products.length > 0 ? `Known PMS products: ${products.join(" | ")}` : "Only mention products present in tenant data.",
    "Keep responses to 2-3 sentences unless the traveller asks for detail.",
    "Ask at most one question in each response.",
    "Do not take card details in chat, invent availability, invent prices, or claim a booking is confirmed unless the PMS has confirmed it.",
    guardrails.length > 0 ? `Tenant guardrails: ${guardrails.join(" | ")}` : "Tenant guardrails: standard Kai booking safety."
  ]
    .filter(Boolean)
    .join("\n");
}

function startsWithI(value: string) {
  return /^i(?:'m|\s)/i.test(value.trim());
}

function previousAssistantStartedWithI(history: AssistantConversationMessage[] | undefined) {
  const previousAssistant = [...(history ?? [])].reverse().find((message) => message.role === "assistant");
  return previousAssistant ? startsWithI(previousAssistant.content) : false;
}

function avoidRepeatedIStart(reply: string, history: AssistantConversationMessage[] | undefined) {
  if (!previousAssistantStartedWithI(history) || !startsWithI(reply)) {
    return reply;
  }

  return reply
    .replace(/^I'm\s+/i, "Sure, I am ")
    .replace(/^I\s+can\b/i, "Sure, I can")
    .replace(/^I\s+have\b/i, "Got it, I have")
    .replace(/^I\s+/i, "Sure, I ");
}

function userAskedForListOrDetail(message?: string | null) {
  return /\b(list|options?|choices?|detail|details|explain|show|which|what are|recommend|recommendation|liveaboards?|yachts?|boats?|trips?)\b/i.test(
    message ?? ""
  );
}

function looksLikeStructuredChoiceReply(reply: string) {
  return /\b(available times|ticket options|extra options|you can choose from|which time|which ticket option|which extra|which one sounds)\b/i.test(
    reply
  );
}

function removeUnrequestedBullets(reply: string, latestUserMessage?: string | null) {
  if (userAskedForListOrDetail(latestUserMessage)) {
    return reply;
  }

  return reply
    .split("\n")
    .map((line) => line.replace(/^\s*[-*•]\s+/, ""))
    .join("\n");
}

function removeRepeatedUserMessage(reply: string, latestUserMessage?: string | null) {
  const userMessage = latestUserMessage?.trim();
  if (!userMessage || userMessage.length < 6) {
    return reply;
  }

  return reply.replace(new RegExp(userMessage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "").replace(/\s{2,}/g, " ");
}

function limitQuestions(reply: string) {
  const firstQuestionIndex = reply.indexOf("?");
  if (firstQuestionIndex < 0) {
    return reply;
  }

  return reply.slice(0, firstQuestionIndex + 1) + reply.slice(firstQuestionIndex + 1).replace(/\?/g, ".");
}

function sentenceParts(reply: string) {
  return reply.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [reply];
}

function capSentences(reply: string, latestUserMessage?: string | null) {
  if (userAskedForListOrDetail(latestUserMessage) || looksLikeStructuredChoiceReply(reply)) {
    return reply;
  }

  if (/https?:\/\//i.test(reply) || /^[\s\d.]+[A-Z][^-:\n]+?\s+-/m.test(reply)) {
    return reply;
  }

  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(reply)) {
    return reply;
  }

  const parts = sentenceParts(reply).map((part) => part.trim()).filter(Boolean);
  return parts.length > 3 ? parts.slice(0, 3).join(" ") : reply;
}

function applyNaturalnessCheck(
  reply: string,
  input: Pick<ComposeAssistantReplyInput, "latestUserMessage" | "conversationHistory">
) {
  return capSentences(
    limitQuestions(
      removeRepeatedUserMessage(
        removeUnrequestedBullets(
          avoidRepeatedIStart(removeRepeatedGreeting(reply), input.conversationHistory),
          input.latestUserMessage
        ),
        input.latestUserMessage
      )
    ),
    input.latestUserMessage
  ).trim();
}

export async function composeAssistantReply(
  input: ComposeAssistantReplyInput
): Promise<AssistantReplyComposerResult> {
  if (!input.llmClient) {
    return {
      source: "DETERMINISTIC",
      reply: applyNaturalnessCheck(input.deterministicReply, input)
    };
  }

  const requiredFacts = input.requiredFacts ?? [];
  let rewrite: string;

  try {
    rewrite = await input.llmClient.composeReply({
      deterministicReply: input.deterministicReply,
      requiredFacts,
      tenantContext: input.tenantContext ?? null,
      tenantSystemPrompt: buildTenantSystemPrompt(input.tenantContext),
      latestUserMessage: input.latestUserMessage ?? null,
      conversationHistory: input.conversationHistory ?? []
    });
    rewrite = applyNaturalnessCheck(rewrite, input);
  } catch (error) {
    console.error("assistant_reply_composer.llm_call_failed", {
      tenantName: input.tenantContext?.tenantName,
      requiredFacts,
      error: error instanceof Error ? error.message : String(error)
    });

    return {
      source: "DETERMINISTIC",
      reply: applyNaturalnessCheck(input.deterministicReply, input)
    };
  }

  const safeRewrite = isSafeRewrite(rewrite, requiredFacts);
  const respectsProductContext = respectsTenantProductContext(rewrite, input.tenantContext);

  if (!safeRewrite || !respectsProductContext) {
    console.warn("assistant_reply_composer.llm_rewrite_rejected", {
      tenantName: input.tenantContext?.tenantName,
      requiredFacts,
      reason: !safeRewrite ? "unsafe_or_missing_required_facts" : "product_context_mismatch",
      rewrite
    });

    return {
      source: "DETERMINISTIC",
      reply: applyNaturalnessCheck(input.deterministicReply, input)
    };
  }

  return {
    source: "LLM",
    reply: rewrite
  };
}
