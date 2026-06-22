export type AssistantReplySource = "DETERMINISTIC" | "LLM";

export interface AssistantReplyComposerResult {
  reply: string;
  source: AssistantReplySource;
}

export interface AssistantTenantContext {
  tenantName: string;
  brandVoice?: string | null;
  pmsProvider?: string | null;
  responseGuardrails?: string[];
  productTitles?: string[];
}

export interface AssistantLlmClient {
  composeReply(input: {
    deterministicReply: string;
    requiredFacts: string[];
    tenantContext?: AssistantTenantContext | null;
  }): Promise<string>;
}

export interface ComposeAssistantReplyInput {
  deterministicReply: string;
  requiredFacts?: string[];
  tenantContext?: AssistantTenantContext | null;
  llmClient?: AssistantLlmClient | null;
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
  const knownProductMentioned = productTitles.some((title) => lowerReply.includes(title.toLowerCase()));
  const mentionsKomodo = /\bkomodo\b/i.test(reply);

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

export async function composeAssistantReply(
  input: ComposeAssistantReplyInput
): Promise<AssistantReplyComposerResult> {
  if (!input.llmClient) {
    return {
      source: "DETERMINISTIC",
      reply: input.deterministicReply
    };
  }

  const requiredFacts = input.requiredFacts ?? [];
  let rewrite: string;

  try {
    rewrite = await input.llmClient.composeReply({
      deterministicReply: input.deterministicReply,
      requiredFacts,
      tenantContext: input.tenantContext ?? null
    });
    rewrite = removeRepeatedGreeting(rewrite);
  } catch {
    return {
      source: "DETERMINISTIC",
      reply: input.deterministicReply
    };
  }

  if (!isSafeRewrite(rewrite, requiredFacts) || !respectsTenantProductContext(rewrite, input.tenantContext)) {
    return {
      source: "DETERMINISTIC",
      reply: input.deterministicReply
    };
  }

  return {
    source: "LLM",
    reply: rewrite
  };
}
