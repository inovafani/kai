import { describe, expect, it } from "vitest";
import { shouldPolishBluePassMarketplaceReply } from "./bluepass-marketplace-reply-gate";

describe("shouldPolishBluePassMarketplaceReply", () => {
  it("skips the LLM rewrite for ACTION-mode replies (already-final transactional confirmations)", () => {
    expect(shouldPolishBluePassMarketplaceReply({ persona: "TRAVELLER", replyMode: "ACTION" })).toBe(false);
  });

  it("keeps the LLM rewrite for CONCIERGE-mode replies (open-ended conversation)", () => {
    expect(shouldPolishBluePassMarketplaceReply({ persona: "TRAVELLER", replyMode: "CONCIERGE" })).toBe(true);
  });

  it("keeps the LLM rewrite for an unclassified traveller's genuine open question", () => {
    expect(shouldPolishBluePassMarketplaceReply({ persona: "UNKNOWN", replyMode: "CONCIERGE" })).toBe(true);
  });

  it("skips the LLM rewrite for an operator reply even though it is CONCIERGE-mode", () => {
    expect(shouldPolishBluePassMarketplaceReply({ persona: "OPERATOR", replyMode: "CONCIERGE" })).toBe(false);
  });

  it("skips the LLM rewrite for a partner reply even though it is CONCIERGE-mode", () => {
    expect(shouldPolishBluePassMarketplaceReply({ persona: "PARTNER", replyMode: "CONCIERGE" })).toBe(false);
  });
});
