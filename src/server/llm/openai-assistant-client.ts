import type { AssistantLlmClient } from "@/core/llm/assistant-reply-composer";

type Fetcher = typeof fetch;

export type OpenAiAssistantEnvironment = Record<string, string | undefined>;

interface OpenAiResponsePayload {
  output_text?: string;
}

const defaultOpenAiModel = "gpt-4.1-mini";

function buildInput(input: { deterministicReply: string; requiredFacts: string[] }) {
  return [
    "Rewrite the assistant reply so it sounds natural and concise.",
    "Do not add new availability, price, date, guest count, booking, payment, or policy facts.",
    "Do not claim that a booking is confirmed.",
    "Preserve every required fact exactly as written.",
    "",
    `Required facts: ${input.requiredFacts.join(" | ")}`,
    "",
    `Deterministic reply: ${input.deterministicReply}`
  ].join("\n");
}

export function createOpenAiAssistantClient(
  env: OpenAiAssistantEnvironment,
  fetcher: Fetcher = fetch
): AssistantLlmClient | null {
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  const model = env.OPENAI_MODEL?.trim() || defaultOpenAiModel;

  return {
    async composeReply(input) {
      const response = await fetcher("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          instructions:
            "You are Kai, a booking assistant. You only polish wording around PMS-verified facts and safety constraints.",
          input: buildInput(input),
          max_output_tokens: 220
        })
      });

      if (!response.ok) {
        throw new Error("OpenAI response generation failed.");
      }

      const payload = (await response.json()) as OpenAiResponsePayload;

      if (!payload.output_text?.trim()) {
        throw new Error("OpenAI response generation returned empty text.");
      }

      return payload.output_text.trim();
    }
  };
}
