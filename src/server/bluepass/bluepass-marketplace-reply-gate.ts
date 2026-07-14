import type { BluePassPersona } from "@/core/bluepass/triage";

export function shouldPolishBluePassMarketplaceReply(input: {
  persona: BluePassPersona;
  replyMode: "CONCIERGE" | "ACTION";
}): boolean {
  if (input.persona === "OPERATOR" || input.persona === "PARTNER") return false;
  return input.replyMode !== "ACTION";
}
