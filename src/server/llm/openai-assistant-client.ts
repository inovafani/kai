import type { AssistantLlmClient, AssistantTenantContext } from "@/core/llm/assistant-reply-composer";
import { getKaiLlmRuntimeSettings } from "@/server/config/kai-environment";

type Fetcher = typeof fetch;

export type OpenAiAssistantEnvironment = Record<string, string | undefined>;

interface OpenAiResponsePayload {
  output_text?: string;
}

const defaultOpenAiModel = "gpt-4.1-mini";
const defaultOpenAiTimeoutMs = 3000;

function formatTenantContext(context?: AssistantTenantContext | null) {
  if (!context) {
    return "Tenant context: not provided";
  }

  return [
    "Tenant context:",
    "- Tenant name: " + context.tenantName,
    "- Brand voice: " + (context.brandVoice || "Warm, concise, practical, and grounded in tenant data."),
    "- PMS provider: " + (context.pmsProvider || "unknown"),
    "- PMS products: " + ((context.productTitles ?? []).join(" | ") || "not provided"),
    "- Tenant guardrails: " + ((context.responseGuardrails ?? []).join(" | ") || "standard Kai guardrails")
  ].join("\n");
}

function buildInput(input: Parameters<AssistantLlmClient["composeReply"]>[0]) {
  return [
    "Rewrite the assistant reply so it sounds natural, helpful, and concise for this tenant's traveller.",
    "Do not start with greetings like Hello, Hi, Good day, or I am Kai; the widget already greeted the traveller.",
    "Use the tenant context only for tone and grounding.",
    "Do not add new availability, price, date, guest count, booking, payment, or policy facts.",
    "Do not invent PMS products or recommendations outside the PMS products list.",
    "Do not claim that a booking is confirmed.",
    "Preserve every required fact exactly as written.",
    "",
    formatTenantContext(input.tenantContext),
    "",
    "Required facts: " + input.requiredFacts.join(" | "),
    "",
    "Deterministic reply: " + input.deterministicReply
  ].join("\n");
}

export function createOpenAiAssistantClient(
  env: OpenAiAssistantEnvironment,
  fetcher: Fetcher = fetch
): AssistantLlmClient | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  const isEnabled = env.ENABLE_OPENAI_LLM === "true";

  if (!isEnabled || !apiKey) {
    return null;
  }

  const runtimeSettings = getKaiLlmRuntimeSettings({ ...env, LLM_PROVIDER: "openai" });
  const model = runtimeSettings.model ?? defaultOpenAiModel;
  const requestTimeoutMs = runtimeSettings.timeoutMs;
  const maxOutputTokens = runtimeSettings.maxOutputTokens;

  return {
    async composeReply(input) {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), requestTimeoutMs);

      try {
        const response = await fetcher("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + apiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model,
            instructions:
              "You are Kai, a tenant-aware booking assistant. You polish wording around PMS-verified facts, tenant tone, and safety constraints.",
            input: buildInput(input),
            max_output_tokens: maxOutputTokens
          }),
          signal: abortController.signal
        });

        if (!response.ok) {
          throw new Error("OpenAI response generation failed.");
        }

        const payload = (await response.json()) as OpenAiResponsePayload;

        if (!payload.output_text?.trim()) {
          throw new Error("OpenAI response generation returned empty text.");
        }

        return payload.output_text.trim();
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}
