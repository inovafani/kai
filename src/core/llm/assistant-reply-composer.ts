export type AssistantReplySource = "DETERMINISTIC" | "LLM";

export interface AssistantReplyComposerResult {
  reply: string;
  source: AssistantReplySource;
}

export interface AssistantLlmClient {
  composeReply(input: {
    deterministicReply: string;
    requiredFacts: string[];
  }): Promise<string>;
}

export interface ComposeAssistantReplyInput {
  deterministicReply: string;
  requiredFacts?: string[];
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
  const rewrite = await input.llmClient.composeReply({
    deterministicReply: input.deterministicReply,
    requiredFacts
  });

  if (!isSafeRewrite(rewrite, requiredFacts)) {
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
