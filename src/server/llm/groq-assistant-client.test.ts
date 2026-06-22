import { describe, expect, it, vi } from "vitest";
import { createGroqAssistantClient } from "./groq-assistant-client";

describe("createGroqAssistantClient", () => {
  it("returns null when GROQ_API_KEY is not configured", () => {
    expect(createGroqAssistantClient({ GROQ_API_KEY: "" })).toBeNull();
  });

  it("uses Groq chat completions to compose a guarded assistant reply", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "Komodo Day Trip is available for 3 guests tomorrow. PMS shows 7 spots remaining at USD 185.00 per guest. I have not confirmed a booking yet."
              }
            }
          ]
        }),
        { status: 200 }
      );
    });

    const client = createGroqAssistantClient(
      {
        GROQ_API_KEY: "gsk-test",
        GROQ_MODEL: "llama-test-model"
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
      "https://api.groq.com/openai/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer gsk-test",
          "Content-Type": "application/json"
        }),
        body: expect.any(String),
        signal: expect.any(AbortSignal)
      })
    );

    const [, requestInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      max_tokens: number;
    };
    expect(body.model).toBe("llama-test-model");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].content).toContain("Komodo Day Trip");
    expect(body.max_tokens).toBe(260);
  });

  it("fails closed when the Groq API response is not ok", async () => {
    const client = createGroqAssistantClient(
      { GROQ_API_KEY: "gsk-test" },
      async () => new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 })
    );

    await expect(
      client?.composeReply({
        deterministicReply: "Safe deterministic reply.",
        requiredFacts: ["Safe"]
      })
    ).rejects.toThrow("Groq response generation failed.");
  });
});
