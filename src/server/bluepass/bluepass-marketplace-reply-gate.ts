export function shouldPolishBluePassMarketplaceReply(input: { replyMode: "CONCIERGE" | "ACTION" }): boolean {
  return input.replyMode !== "ACTION";
}
