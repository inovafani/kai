import { describe, expect, it } from "vitest";
import { composeAssistantReply, type AssistantLlmClient } from "./assistant-reply-composer";

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

  it("passes tenant knowledge to the LLM rewrite", async () => {
    const capturedInputs: Parameters<AssistantLlmClient["composeReply"]>[0][] = [];
    const result = await composeAssistantReply({
      deterministicReply:
        "For tomorrow, available PMS options are Komodo Day Trip and Private Charter. Komodo Day Trip can be checked for availability, while Private Charter requires operator confirmation. Which one would you like me to check, and for how many guests?",
      requiredFacts: ["Komodo Day Trip", "Private Charter", "operator confirmation"],
      tenantContext: {
        tenantName: "Kai Demo",
        brandVoice: "Warm, concise, practical, and grounded in tenant data.",
        pmsProvider: "MOCK",
        responseGuardrails: ["Do not invent availability."],
        productTitles: ["Komodo Day Trip", "Private Charter"]
      },
      llmClient: {
        async composeReply(input) {
          capturedInputs.push(input);
          return "For tomorrow, I can suggest Komodo Day Trip or Private Charter. Komodo Day Trip can be checked for availability, while Private Charter needs operator confirmation.";
        }
      }
    });

    expect(result.source).toBe("LLM");
    expect(capturedInputs[0].tenantContext).toEqual({
      tenantName: "Kai Demo",
      brandVoice: "Warm, concise, practical, and grounded in tenant data.",
      pmsProvider: "MOCK",
      responseGuardrails: ["Do not invent availability."],
      productTitles: ["Komodo Day Trip", "Private Charter"]
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

  it("falls back to the deterministic reply when an LLM rewrite mentions products outside tenant context", async () => {
    const deterministicReply =
      "I can help with Boattime Yacht Charters experiences, availability checks, booking inquiries, or handoff to the team.";

    const result = await composeAssistantReply({
      deterministicReply,
      tenantContext: {
        tenantName: "Boattime Yacht Charters",
        productTitles: ["Gold Coast Whale Escape", "Twilight Drift"]
      },
      llmClient: {
        async composeReply() {
          return "I can help with Komodo tours, availability checks, booking inquiries, or handoff to the team.";
        }
      }
    });

    expect(result).toEqual({
      source: "DETERMINISTIC",
      reply: deterministicReply
    });
  });

  it("removes repeated greetings from LLM rewrites after the welcome message", async () => {
    const result = await composeAssistantReply({
      deterministicReply:
        "For tomorrow, available PMS options are Gold Coast Whale Escape and Twilight Drift. Which one would you like me to check, and for how many guests?",
      requiredFacts: ["Gold Coast Whale Escape", "Twilight Drift"],
      tenantContext: {
        tenantName: "Boattime Yacht Charters",
        productTitles: ["Gold Coast Whale Escape", "Twilight Drift"]
      },
      llmClient: {
        async composeReply() {
          return "Hello, I'm Kai, your booking assistant. For tomorrow, available PMS options are Gold Coast Whale Escape and Twilight Drift. Which one would you like me to check, and for how many guests?";
        }
      }
    });

    expect(result).toEqual({
      source: "LLM",
      reply:
        "For tomorrow, available PMS options are Gold Coast Whale Escape and Twilight Drift. Which one would you like me to check, and for how many guests?"
    });
  });

  it("falls back to the deterministic reply when LLM generation fails", async () => {
    const deterministicReply = "How can I help with your booking?";

    const result = await composeAssistantReply({
      deterministicReply,
      llmClient: {
        async composeReply() {
          throw new Error("OpenAI response generation failed.");
        }
      }
    });

    expect(result).toEqual({
      source: "DETERMINISTIC",
      reply: deterministicReply
    });
  });
});
