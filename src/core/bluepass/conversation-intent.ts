import type { BluePassPersona } from "./triage";

export function isBluePassResetConversationRequest(content: string) {
  const normalized = normalizeBluePassConversationText(content);

  return /^(?:new chat|fresh chat|start over|restart|reset|reset chat|clear chat|mulai baru|chat baru|ulang dari awal)$/.test(
    normalized
  );
}

export function buildBluePassResetConversationReply(input?: {
  persona?: BluePassPersona | null;
  identityName?: string | null;
}) {
  if (input?.persona === "OPERATOR") {
    const name = input.identityName?.trim();
    const prefix = name ? `${name}: ` : "";

    return `${prefix}Fresh chat started. I can help with BluePass operator onboarding, claim status, inquiry replies, payout questions, or traveller-facing product info.`;
  }

  if (input?.persona === "PARTNER") {
    return "Fresh chat started. I can help explain BluePass partner terms, compare yacht options for a client, or capture your partner contact details when you are ready.";
  }

  return "Fresh chat started. I can help compare BluePass liveaboards, recommend Komodo or Raja Ampat options, or prepare a new operator inquiry when you are ready.";
}

export function normalizeBluePassConversationText(content: string) {
  return content.toLowerCase().replace(/\s+/g, " ").trim();
}
