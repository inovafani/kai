import { describe, expect, it, vi } from "vitest";
import {
  createBluePassRouterClient,
  createGroqBluePassRouterClient,
  createOpenAiBluePassRouterClient
} from "./bluepass-router-client";

const baseRouterInput = {
  latestMessage: "in komodo please",
  priorTravellerMessages: ["any recommendation for raja ampat?"],
  knownIntent: {},
  missingFields: ["destination", "dateWindow", "guests", "travellerName", "travellerEmail", "travellerPhone"],
  hasSelectedYacht: false,
  mentionedYachtNames: []
};

describe("createGroqBluePassRouterClient", () => {
  it("returns null when GROQ_API_KEY is not configured", () => {
    expect(createGroqBluePassRouterClient({ GROQ_API_KEY: "" })).toBeNull();
  });

  it("calls Groq chat completions in JSON mode and parses the routing decision", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"action":"RECOMMENDATION","destination":"Komodo"}' } }]
        }),
        { status: 200 }
      );
    });

    const client = createGroqBluePassRouterClient({ GROQ_API_KEY: "gsk-test", GROQ_MODEL: "llama-test" }, fetcher);
    const decision = await client?.route(baseRouterInput);

    expect(decision).toMatchObject({ action: "RECOMMENDATION", intent: { destination: "Komodo" } });

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
    expect(body.messages[1].content).toContain("in komodo please");
    expect(body.messages[1].content).toContain("any recommendation for raja ampat?");
  });

  it("throws when the response cannot be parsed into a decision", async () => {
    const client = createGroqBluePassRouterClient(
      { GROQ_API_KEY: "gsk-test" },
      async () => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 })
    );

    await expect(client?.route(baseRouterInput)).rejects.toThrow();
  });

  it("throws when the Groq API response is not ok", async () => {
    const client = createGroqBluePassRouterClient(
      { GROQ_API_KEY: "gsk-test" },
      async () => new Response(JSON.stringify({ error: "bad" }), { status: 500 })
    );

    await expect(client?.route(baseRouterInput)).rejects.toThrow("BluePass router LLM call failed.");
  });
});

describe("createOpenAiBluePassRouterClient", () => {
  it("returns null when OPENAI_API_KEY is not configured", () => {
    expect(createOpenAiBluePassRouterClient({ OPENAI_API_KEY: "" })).toBeNull();
  });

  it("calls OpenAI chat completions in JSON mode and parses the routing decision", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"SMALL_TALK"}' } }] }), {
        status: 200
      });
    });

    const client = createOpenAiBluePassRouterClient({ OPENAI_API_KEY: "sk-test" }, fetcher);
    const decision = await client?.route(baseRouterInput);

    expect(decision).toMatchObject({ action: "SMALL_TALK" });
    const [url] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
  });
});

describe("createBluePassRouterClient", () => {
  it("returns null when LLM is not enabled", () => {
    expect(createBluePassRouterClient({ GROQ_API_KEY: "gsk-test" })).toBeNull();
  });

  it("selects the groq client by default when enabled", () => {
    const client = createBluePassRouterClient({ ENABLE_LLM: "true", GROQ_API_KEY: "gsk-test" });
    expect(client).not.toBeNull();
  });

  it("selects the openai client when LLM_PROVIDER is openai", () => {
    const client = createBluePassRouterClient({
      ENABLE_LLM: "true",
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test"
    });
    expect(client).not.toBeNull();
  });
});
