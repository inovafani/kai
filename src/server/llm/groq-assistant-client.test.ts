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
      temperature: number;
    };
    expect(body.model).toBe("llama-test-model");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].content).toContain("Komodo Day Trip");
    expect(body.max_tokens).toBe(260);
    expect(body.temperature).toBe(0.75);
  });

  it("uses the 70B Groq model by default and includes conversation history", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: "Safe reply." } }] }), { status: 200 });
    });
    const client = createGroqAssistantClient({ GROQ_API_KEY: "gsk-test" }, fetcher);

    await client?.composeReply({
      deterministicReply: "Safe reply.",
      requiredFacts: ["Safe"],
      tenantSystemPrompt: "Tenant-specific system prompt.",
      latestUserMessage: "12pm please",
      conversationHistory: [
        { role: "traveller", content: "28 June for 2 people" },
        { role: "assistant", content: "I found 9:00 AM and 12:00 PM." },
        { role: "traveller", content: "12pm please" }
      ]
    });

    const [, requestInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      temperature: number;
    };
    expect(body.model).toBe("llama-3.3-70b-versatile");
    expect(body.messages[0]).toEqual({ role: "system", content: "Tenant-specific system prompt." });
    expect(body.messages[1].content).toContain("Traveller: 28 June for 2 people");
    expect(body.messages[1].content).toContain("Kai: I found 9:00 AM and 12:00 PM.");
    expect(body.messages[1].content).toContain("Latest traveller message: 12pm please");
    expect(body.temperature).toBe(0.75);
  });

  it("grants general-knowledge concierge freedom when no required facts are present", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: "Bali is great for healing." } }] }), {
        status: 200
      });
    });
    const client = createGroqAssistantClient({ GROQ_API_KEY: "gsk-test" }, fetcher);

    await client?.composeReply({
      deterministicReply: "I can help with that.",
      requiredFacts: [],
      latestUserMessage: "is bali good for healing?"
    });

    const [, requestInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userPrompt = body.messages[1].content;
    expect(userPrompt).toContain("Answer the traveller naturally and helpfully");
    expect(userPrompt).toContain("knowledgeable, well-travelled Indonesia travel concierge");
    expect(userPrompt).not.toContain("Preserve every required fact exactly as written.");
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
