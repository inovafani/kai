import { describe, expect, it } from "vitest";
import { composeAssistantReply } from "./assistant-reply-composer";

describe("assistant reply composer", () => {
  it("uses an LLM rewrite only when it preserves required PMS facts", async () => {
    const result = await composeAssistantReply({
      deterministicReply:
        "Komodo Day Trip is available for 3 guests on tomorrow. PMS shows 7 spots remaining at USD 185.00 per guest. I have not confirmed a booking yet.",
      requiredFacts: ["Komodo Day Trip", "3 guests", "tomorrow", "7 spots", "USD 185.00"],
      llmClient: {
        async composeReply() {
          return "Komodo Day Trip is available for 3 guests tomorrow. PMS shows 7 spots remaining at USD 185.00 per guest. I have not confirmed a booking yet.";
        }
      }
    });

    expect(result).toEqual({
      source: "LLM",
      reply:
        "Komodo Day Trip is available for 3 guests tomorrow. PMS shows 7 spots remaining at USD 185.00 per guest. I have not confirmed a booking yet."
    });
  });

  it("falls back to the deterministic reply when an LLM rewrite drops PMS facts", async () => {
    const deterministicReply =
      "Komodo Day Trip is available for 3 guests on tomorrow. PMS shows 7 spots remaining at USD 185.00 per guest. I have not confirmed a booking yet.";

    const result = await composeAssistantReply({
      deterministicReply,
      requiredFacts: ["Komodo Day Trip", "3 guests", "tomorrow", "7 spots", "USD 185.00"],
      llmClient: {
        async composeReply() {
          return "Komodo Day Trip looks available tomorrow. I can help you book it.";
        }
      }
    });

    expect(result).toEqual({
      source: "DETERMINISTIC",
      reply: deterministicReply
    });
  });

  it("falls back to the deterministic reply when an LLM rewrite claims a confirmed booking", async () => {
    const deterministicReply =
      "Private Charter requires operator confirmation. I can collect the details, but I will not confirm availability automatically.";

    const result = await composeAssistantReply({
      deterministicReply,
      requiredFacts: ["Private Charter", "operator confirmation"],
      llmClient: {
        async composeReply() {
          return "Private Charter is confirmed for you. Your booking is complete.";
        }
      }
    });

    expect(result).toEqual({
      source: "DETERMINISTIC",
      reply: deterministicReply
    });
  });
});
