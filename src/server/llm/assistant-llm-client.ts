import type { AssistantLlmClient } from "@/core/llm/assistant-reply-composer";
import { createGroqAssistantClient } from "./groq-assistant-client";
import { createOpenAiAssistantClient } from "./openai-assistant-client";

type Fetcher = typeof fetch;

export type AssistantLlmEnvironment = Record<string, string | undefined>;

export function createAssistantLlmClient(
  env: AssistantLlmEnvironment,
  fetcher: Fetcher = fetch
): AssistantLlmClient | null {
  const isEnabled = env.ENABLE_LLM === "true" || env.ENABLE_OPENAI_LLM === "true";

  if (!isEnabled) {
    return null;
  }

  const provider = (env.LLM_PROVIDER ?? (env.ENABLE_OPENAI_LLM === "true" ? "openai" : "groq")).toLowerCase();

  if (provider === "openai") {
    return createOpenAiAssistantClient(
      {
        ...env,
        ENABLE_OPENAI_LLM: "true"
      },
      fetcher
    );
  }

  if (provider === "groq") {
    return createGroqAssistantClient(env, fetcher);
  }

  return null;
}
