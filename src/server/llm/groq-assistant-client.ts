import type { AssistantLlmClient, AssistantTenantContext } from "@/core/llm/assistant-reply-composer";
import { getKaiLlmRuntimeSettings } from "@/server/config/kai-environment";

type Fetcher = typeof fetch;

export type GroqAssistantEnvironment = Record<string, string | undefined>;

interface GroqChatCompletionPayload {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const defaultGroqModel = "llama-3.3-70b-versatile";
const defaultGroqTimeoutMs = 3000;

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

function buildUserPrompt(input: Parameters<AssistantLlmClient["composeReply"]>[0]) {
  const history = (input.conversationHistory ?? [])
    .map((message) => `${message.role === "traveller" ? "Traveller" : "Kai"}: ${message.content}`)
    .join("\n");

  return [
    "Rewrite the assistant reply so it sounds natural, helpful, and concise for this tenant's traveller.",
    "Do not start with greetings like Hello, Hi, Good day, or I am Kai; the widget already greeted the traveller.",
    "Use the tenant context only for tone and grounding.",
    "Do not add new availability, price, date, guest count, booking, payment, or policy facts.",
    "Do not invent PMS products or recommendations outside the PMS products list.",
    "Do not claim that a booking is confirmed.",
    "Preserve every required fact exactly as written.",
    "Keep the reply to 2-3 sentences unless the traveller explicitly asks for detail.",
    "Ask no more than one question.",
    "Avoid bullet points unless the traveller asked for a list or the deterministic reply contains required options.",
    "",
    formatTenantContext(input.tenantContext),
    "",
    "Conversation history:",
    history || "No prior conversation history.",
    "",
    "Latest traveller message: " + (input.latestUserMessage ?? "not provided"),
    "",
    "Required facts: " + input.requiredFacts.join(" | "),
    "",
    "Deterministic reply: " + input.deterministicReply
  ].join("\n");
}

export function createGroqAssistantClient(
  env: GroqAssistantEnvironment,
  fetcher: Fetcher = fetch
): AssistantLlmClient | null {
  const apiKey = env.GROQ_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  const runtimeSettings = getKaiLlmRuntimeSettings({ ...env, LLM_PROVIDER: "groq" });
  const model = runtimeSettings.model ?? defaultGroqModel;
  const requestTimeoutMs = runtimeSettings.timeoutMs;
  const maxOutputTokens = runtimeSettings.maxOutputTokens;

  return {
    async composeReply(input) {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), requestTimeoutMs);

      try {
        const response = await fetcher("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + apiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content: input.tenantSystemPrompt || formatTenantContext(input.tenantContext)
              },
              {
                role: "user",
                content: buildUserPrompt(input)
              }
            ],
            max_tokens: maxOutputTokens,
            temperature: 0.75
          }),
          signal: abortController.signal
        });

        if (!response.ok) {
          throw new Error("Groq response generation failed.");
        }

        const payload = (await response.json()) as GroqChatCompletionPayload;
        const text = payload.choices?.[0]?.message?.content?.trim();

        if (!text) {
          throw new Error("Groq response generation returned empty text.");
        }

        return text;
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}
