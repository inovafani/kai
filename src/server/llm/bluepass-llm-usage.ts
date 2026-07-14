import { prisma } from "@/lib/prisma";

export type BluePassLlmCallType = "router" | "polish";
export type BluePassLlmProvider = "groq" | "openai";

export interface BluePassLlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// Approximate published per-token pricing, USD per 1M tokens. These drift as providers change
// pricing - verify against Groq's and OpenAI's current pricing pages before trusting this for
// real budgeting. An unrecognized provider/model returns a null estimate rather than guessing.
const pricingPerMillionTokensUsd: Record<BluePassLlmProvider, Record<string, { input: number; output: number }>> = {
  groq: {
    "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 }
  },
  openai: {
    "gpt-4.1-mini": { input: 0.4, output: 1.6 }
  }
};

export function estimateBluePassLlmCostUsd(
  provider: BluePassLlmProvider,
  model: string,
  usage: BluePassLlmUsage
): number | null {
  const rates = pricingPerMillionTokensUsd[provider]?.[model];
  if (!rates) return null;

  return (usage.promptTokens * rates.input + usage.completionTokens * rates.output) / 1_000_000;
}

export function logBluePassLlmUsage(input: {
  callType: BluePassLlmCallType;
  provider: BluePassLlmProvider;
  model: string;
  tenantName?: string | null;
  usage: BluePassLlmUsage;
}) {
  const estimatedCostUsd = estimateBluePassLlmCostUsd(input.provider, input.model, input.usage);

  console.log("bluepass_llm.usage", {
    callType: input.callType,
    provider: input.provider,
    model: input.model,
    tenantName: input.tenantName ?? null,
    promptTokens: input.usage.promptTokens,
    completionTokens: input.usage.completionTokens,
    totalTokens: input.usage.totalTokens,
    estimatedCostUsd
  });

  // Best-effort persistence: intentionally not awaited by the caller (the LLM reply has already
  // resolved by this point) and never throws, so a DB hiccup can never break a traveller reply.
  prisma.llmUsageEvent
    .create({
      data: {
        callType: input.callType,
        provider: input.provider,
        model: input.model,
        tenantName: input.tenantName ?? null,
        promptTokens: input.usage.promptTokens,
        completionTokens: input.usage.completionTokens,
        totalTokens: input.usage.totalTokens,
        estimatedCostUsd
      }
    })
    .catch((error) => {
      console.warn("bluepass_llm.usage_persist_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    });
}
