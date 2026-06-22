import { describe, expect, it, vi } from "vitest";
import { createOpenAiAssistantClient } from "./openai-assistant-client";

describe("createOpenAiAssistantClient", () => {
  it("returns null when OPENAI_API_KEY is not configured", () => {
    expect(createOpenAiAssistantClient({ OPENAI_API_KEY: "", ENABLE_OPENAI_LLM: "true" })).toBeNull();
  });

  it("returns null unless ENABLE_OPENAI_LLM is true", () => {
    expect(createOpenAiAssistantClient({ OPENAI_API_KEY: "sk-test" })).toBeNull();
  });

  it("uses the Responses API to compose a guarded assistant reply", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          output_text:
            "Komodo Day Trip is available for 3 guests tomorrow. PMS shows 7 spots remaining at USD 185.00 per guest. I have not confirmed a booking yet."
        }),
        { status: 200 }
      );
    });

    const client = createOpenAiAssistantClient(
      {
        OPENAI_API_KEY: "sk-test",
        ENABLE_OPENAI_LLM: "true",
        OPENAI_MODEL: "gpt-test-model"
      },
      fetcher
    );

    await expect(
      client?.composeReply({
        deterministicReply:
          "Komodo Day Trip is available for 3 guests on tomorrow. PMS shows 7 spots remaining at USD 185.00 per guest. I have not confirmed a booking yet.",
        requiredFacts: ["Komodo Day Trip", "3 guests", "tomorrow", "7 spots", "USD 185.00"]
      })
    ).resolves.toBe(
      "Komodo Day Trip is available for 3 guests tomorrow. PMS shows 7 spots remaining at USD 185.00 per guest. I have not confirmed a booking yet."
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
          "Content-Type": "application/json"
        }),
        body: expect.any(String)
      })
    );

    const [, requestInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string) as {
      model: string;
      input: string;
      max_output_tokens: number;
    };
    expect(body.model).toBe("gpt-test-model");
    expect(body.input).toContain("Komodo Day Trip");
    expect(body.input).toContain("USD 185.00");
    expect(body.max_output_tokens).toBe(260);
  });

  it("passes an abort signal so slow OpenAI calls can time out", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ output_text: "Safe reply." }), { status: 200 });
    });

    const client = createOpenAiAssistantClient(
      {
        OPENAI_API_KEY: "sk-test",
        ENABLE_OPENAI_LLM: "true",
        OPENAI_TIMEOUT_MS: "1500"
      },
      fetcher
    );

    await client?.composeReply({
      deterministicReply: "Safe reply.",
      requiredFacts: ["Safe"]
    });

    const [, requestInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestInit.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails closed when the OpenAI API response is not ok", async () => {
    const client = createOpenAiAssistantClient(
      { OPENAI_API_KEY: "sk-test", ENABLE_OPENAI_LLM: "true" },
      async () => new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 })
    );

    await expect(
      client?.composeReply({
        deterministicReply: "Safe deterministic reply.",
        requiredFacts: ["Safe"]
      })
    ).rejects.toThrow("OpenAI response generation failed.");
  });
});
