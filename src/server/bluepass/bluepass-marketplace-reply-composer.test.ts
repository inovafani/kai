import { describe, expect, it } from "vitest";
import type { AssistantLlmClient } from "@/core/llm/assistant-reply-composer";
import { composeBluePassMarketplaceAssistantReply } from "./bluepass-marketplace-reply-composer";

describe("composeBluePassMarketplaceAssistantReply", () => {
  it("lets concierge discovery use the LLM as the answer layer instead of forcing deterministic facts", async () => {
    const capturedInputs: Parameters<AssistantLlmClient["composeReply"]>[0][] = [];
    const result = await composeBluePassMarketplaceAssistantReply({
      deterministicReply:
        "Good BluePass liveaboard options:\n1. Aliikai - Premium in Raja Ampat.\n2. Alila Purnama - Legend in Komodo.",
      latestMessage: "i want healing but im confuse where to go",
      conversationHistory: [],
      llmClient: {
        async composeReply(input) {
          capturedInputs.push(input);
          return "For a healing trip, I would steer you toward Raja Ampat on Aliikai if you want quiet reefs and slow mornings, or Komodo on Alila Purnama if you want a warmer spa-like phinisi feel. Are you imagining solo/couple calm, or a group trip?";
        }
      },
      marketplaceResult: {
        replyMode: "CONCIERGE",
        bluepassMatches: [
          { name: "Aliikai", region: "Raja Ampat" },
          { name: "Alila Purnama", region: "Komodo" }
        ],
        bluepassInquiry: null,
        assistantContent: ""
      }
    });

    expect(result.source).toBe("LLM");
    expect(result.reply).toContain("healing trip");
    expect(result.reply).toContain("Raja Ampat");
    expect(result.reply).not.toContain("Good BluePass liveaboard options");
    expect(capturedInputs[0].requiredFacts).toEqual([]);
  });

  it("keeps transactional replies fact-preserving", async () => {
    const capturedInputs: Parameters<AssistantLlmClient["composeReply"]>[0][] = [];
    const result = await composeBluePassMarketplaceAssistantReply({
      deterministicReply:
        "I prepared BluePass inquiry inquiry_123 for Calico Jack. This is not a confirmed booking; availability, final price, and payment wait for operator confirmation.",
      latestMessage: "yes please send inquiry",
      conversationHistory: [],
      llmClient: {
        async composeReply(input) {
          capturedInputs.push(input);
          return "Calico Jack is confirmed for you.";
        }
      },
      marketplaceResult: {
        bluepassMatches: [],
        bluepassInquiry: {
          selectedYachtName: "Calico Jack",
          destination: "Komodo",
          dateWindow: "19 July",
          guests: 2
        },
        assistantContent: ""
      }
    });

    expect(result.source).toBe("DETERMINISTIC");
    expect(result.reply).toContain("I prepared BluePass inquiry");
    expect(capturedInputs[0].requiredFacts).toEqual(
      expect.arrayContaining(["Calico Jack", "Komodo", "19 July", "2"])
    );
  });
});
