import { describe, expect, it, vi } from "vitest";
import {
  createGenericBookingRouterClient,
  createGroqGenericBookingRouterClient,
  createOpenAiGenericBookingRouterClient
} from "./generic-booking-router-client";

const baseRouterInput = {
  tenantName: "Boattime Yacht Charters",
  pmsProvider: "REZDY",
  latestMessage: "is this suitable for kids?",
  priorTravellerMessages: ["do you have a whale watching tour?"],
  productTitles: ["Gold Coast Whale Escape", "Twilight Drift"],
  knownProductHint: "Gold Coast Whale Escape",
  knownDateText: null,
  knownGuests: null,
  missingSlots: ["date", "guests"]
};

describe("createGroqGenericBookingRouterClient", () => {
  it("returns null when GROQ_API_KEY is not configured", () => {
    expect(createGroqGenericBookingRouterClient({ GROQ_API_KEY: "" })).toBeNull();
  });

  it("calls Groq chat completions in JSON mode and parses the routing decision", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"intent":"GENERAL_QUESTION"}' } }] }), {
        status: 200
      });
    });

    const client = createGroqGenericBookingRouterClient({ GROQ_API_KEY: "gsk-test", GROQ_MODEL: "llama-test" }, fetcher);
    const decision = await client?.route(baseRouterInput);

    expect(decision).toEqual({ intent: "GENERAL_QUESTION" });

    const [url, requestInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    const body = JSON.parse(requestInit.body as string) as {
      model: string;
      response_format: { type: string };
      messages: Array<{ role: string; content: string }>;
      temperature: number;
    };
    expect(body.model).toBe("llama-test");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.temperature).toBe(0.1);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("Boattime Yacht Charters");
    expect(body.messages[0].content).toContain("REZDY");
    expect(body.messages[1].content).toContain("is this suitable for kids?");
    expect(body.messages[1].content).toContain("Gold Coast Whale Escape");
    expect(body.messages[1].content).toContain("do you have a whale watching tour?");
  });

  it("logs real token usage from the Groq router response instead of discarding it", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"intent":"GENERAL_QUESTION"}' } }],
          usage: { prompt_tokens: 150, completion_tokens: 10, total_tokens: 160 }
        }),
        { status: 200 }
      );
    });

    const client = createGroqGenericBookingRouterClient({ GROQ_API_KEY: "gsk-test", GROQ_MODEL: "llama-test" }, fetcher);
    await client?.route(baseRouterInput);

    expect(logSpy).toHaveBeenCalledWith(
      "bluepass_llm.usage",
      expect.objectContaining({
        callType: "router",
        provider: "groq",
        model: "llama-test",
        promptTokens: 150,
        completionTokens: 10,
        totalTokens: 160
      })
    );

    logSpy.mockRestore();
  });

  it("throws when the response cannot be parsed into a decision", async () => {
    const client = createGroqGenericBookingRouterClient(
      { GROQ_API_KEY: "gsk-test" },
      async () => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 })
    );

    await expect(client?.route(baseRouterInput)).rejects.toThrow();
  });

  it("throws when the Groq API response is not ok", async () => {
    const client = createGroqGenericBookingRouterClient(
      { GROQ_API_KEY: "gsk-test" },
      async () => new Response(JSON.stringify({ error: "bad" }), { status: 500 })
    );

    await expect(client?.route(baseRouterInput)).rejects.toThrow("Generic booking router LLM call failed.");
  });
});

describe("createOpenAiGenericBookingRouterClient", () => {
  it("returns null when OPENAI_API_KEY is not configured", () => {
    expect(createOpenAiGenericBookingRouterClient({ OPENAI_API_KEY: "" })).toBeNull();
  });

  it("calls OpenAI chat completions in JSON mode and parses the routing decision", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"intent":"HUMAN_HANDOFF"}' } }] }), {
        status: 200
      });
    });

    const client = createOpenAiGenericBookingRouterClient({ OPENAI_API_KEY: "sk-test" }, fetcher);
    const decision = await client?.route(baseRouterInput);

    expect(decision).toEqual({ intent: "HUMAN_HANDOFF" });
    const [url] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
  });
});

describe("createGenericBookingRouterClient", () => {
  it("returns null when LLM is not enabled", () => {
    expect(createGenericBookingRouterClient({ GROQ_API_KEY: "gsk-test" })).toBeNull();
  });

  it("selects the groq client by default when enabled", () => {
    const client = createGenericBookingRouterClient({ ENABLE_LLM: "true", GROQ_API_KEY: "gsk-test" });
    expect(client).not.toBeNull();
  });

  it("selects the openai client when LLM_PROVIDER is openai", () => {
    const client = createGenericBookingRouterClient({
      ENABLE_LLM: "true",
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test"
    });
    expect(client).not.toBeNull();
  });
});
