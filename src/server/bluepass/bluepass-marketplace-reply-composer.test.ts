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

  it("rejects a concierge-mode LLM rewrite that drops a real percentage fact, even though concierge mode has no other required facts", async () => {
    // Regression: a real bug reached production behavior in manual testing - the LLM rewrote an
    // accurate commission-breakdown answer into a hallucinated "isn't publicly disclosed" hedge, and
    // it passed isSafeRewrite because concierge mode's requiredFacts list was empty. Percentages in
    // the deterministic reply must survive rewriting regardless of replyMode.
    const capturedInputs: Parameters<AssistantLlmClient["composeReply"]>[0][] = [];
    const result = await composeBluePassMarketplaceAssistantReply({
      deterministicReply:
        "BluePass takes a capped 18% total: 5% funds reef conservation, 5% goes to partners who refer guests, 3% covers payment processing, and 5% is the platform fee. Operators keep 82% of their own rate, and guests never pay more than booking direct.",
      latestMessage: "what commission does BluePass take",
      conversationHistory: [],
      llmClient: {
        async composeReply(input) {
          capturedInputs.push(input);
          return "BluePass Australia's commission structure isn't publicly disclosed, but our pricing is competitive and transparent, with no hidden fees.";
        }
      },
      marketplaceResult: {
        replyMode: "CONCIERGE",
        bluepassMatches: [],
        bluepassInquiry: null,
        assistantContent: ""
      }
    });

    expect(capturedInputs[0].requiredFacts).toEqual(expect.arrayContaining(["18%", "82%", "5%", "3%"]));
    expect(result.source).toBe("DETERMINISTIC");
    expect(result.reply).toContain("18%");
    expect(result.reply).toContain("82%");
    expect(result.reply).not.toContain("isn't publicly disclosed");
  });

  it("still allows a concierge-mode LLM rewrite that correctly preserves the real percentages", async () => {
    const result = await composeBluePassMarketplaceAssistantReply({
      deterministicReply:
        "BluePass takes a capped 18% total: 5% funds reef conservation, 5% goes to partners who refer guests, 3% covers payment processing, and 5% is the platform fee. Operators keep 82% of their own rate, and guests never pay more than booking direct.",
      latestMessage: "what commission does BluePass take",
      conversationHistory: [],
      llmClient: {
        async composeReply() {
          return "Great question - BluePass takes a capped 18% total (5% conservation, 5% partners, 3% payments, 5% platform), so operators keep 82% of their own rate. Guests never pay more than booking direct.";
        }
      },
      marketplaceResult: {
        replyMode: "CONCIERGE",
        bluepassMatches: [],
        bluepassInquiry: null,
        assistantContent: ""
      }
    });

    expect(result.source).toBe("LLM");
    expect(result.reply).toContain("18%");
    expect(result.reply).toContain("82%");
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
