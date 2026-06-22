import { describe, expect, it, vi } from "vitest";
import { createAssistantLlmClient } from "./assistant-llm-client";

describe("createAssistantLlmClient", () => {
  it("returns null when ENABLE_LLM is not true", () => {
    expect(
      createAssistantLlmClient({
        ENABLE_LLM: "false",
        LLM_PROVIDER: "groq",
        GROQ_API_KEY: "gsk-test"
      })
    ).toBeNull();
  });

  it("creates a Groq client when LLM_PROVIDER is groq", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Safe reply." } }]
        }),
        { status: 200 }
      );
    });

    const client = createAssistantLlmClient(
      {
        ENABLE_LLM: "true",
        LLM_PROVIDER: "groq",
        GROQ_API_KEY: "gsk-test"
      },
      fetcher
    );

    await expect(
      client?.composeReply({
        deterministicReply: "Safe reply.",
        requiredFacts: ["Safe"]
      })
    ).resolves.toBe("Safe reply.");

    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("creates an OpenAI client when LLM_PROVIDER is openai", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ output_text: "Safe reply." }), { status: 200 });
    });

    const client = createAssistantLlmClient(
      {
        ENABLE_LLM: "true",
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "sk-test"
      },
      fetcher
    );

    await expect(
      client?.composeReply({
        deterministicReply: "Safe reply.",
        requiredFacts: ["Safe"]
      })
    ).resolves.toBe("Safe reply.");

    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe("https://api.openai.com/v1/responses");
  });
});
