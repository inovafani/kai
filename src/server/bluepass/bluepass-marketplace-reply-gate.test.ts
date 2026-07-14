import { describe, expect, it } from "vitest";
import { shouldPolishBluePassMarketplaceReply } from "./bluepass-marketplace-reply-gate";

describe("shouldPolishBluePassMarketplaceReply", () => {
  it("skips the LLM rewrite for ACTION-mode replies (already-final transactional confirmations)", () => {
    expect(shouldPolishBluePassMarketplaceReply({ replyMode: "ACTION" })).toBe(false);
  });

  it("keeps the LLM rewrite for CONCIERGE-mode replies (open-ended conversation)", () => {
    expect(shouldPolishBluePassMarketplaceReply({ replyMode: "CONCIERGE" })).toBe(true);
  });
});
