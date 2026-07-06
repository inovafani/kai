import type { BluePassYachtCard } from "@/core/bluepass/catalog";
import type { BluePassSuggestedReply } from "@/core/bluepass/triage";
import {
  createAssistantMessage,
  createTravellerMessage,
  findOrCreateWhatsAppConversation,
  listRecentTravellerMessageContents,
  setWhatsAppConversationControlMode
} from "@/server/conversation/conversation-repository";
import { sendWhatsAppInteractiveButtons, sendWhatsAppText } from "@/server/whatsapp/client";
import { handleBluePassMarketplaceMessage } from "./bluepass-message-flow";

export type BluePassTravellerWhatsAppResult =
  | { status: "SKIPPED"; reason: string }
  | { status: "HUMAN_CONTROLLED"; conversationId: string }
  | { status: "REPLIED"; conversationId: string; providerMessageId: string | null }
  | { status: "SEND_FAILED"; conversationId: string; reason: string };

/**
 * Inbound traveller (or unclassified) message on the Kai WhatsApp number.
 *
 * Anchors a phone-keyed Conversation, persists the turn, and — unless a human
 * has taken the thread over — runs the marketplace flow (persona triage +
 * concierge) and sends the reply back over the same number. The reply always
 * rides the 24-hour service window because it answers an inbound message.
 */
export async function handleBluePassTravellerWhatsAppMessage(input: {
  fromPhone: string;
  content: string;
}): Promise<BluePassTravellerWhatsAppResult> {
  const tenantId = resolveBluePassWhatsAppTenantId();
  if (!tenantId) {
    return { status: "SKIPPED", reason: "BLUEPASS_WHATSAPP_TENANT_ID is not configured." };
  }

  const whatsappPhone = normalizePhone(input.fromPhone);
  const conversation = await findOrCreateWhatsAppConversation({ tenantId, whatsappPhone });

  const priorTravellerMessages = await listRecentTravellerMessageContents({
    tenantId,
    conversationId: conversation.id
  });

  await createTravellerMessage({
    tenantId,
    conversationId: conversation.id,
    content: input.content
  });

  // A human owns this thread (Business-app coexistence takeover or manual
  // pause) — keep the transcript, skip the concierge reply.
  if (conversation.controlMode !== "AI") {
    return { status: "HUMAN_CONTROLLED", conversationId: conversation.id };
  }

  const reply = await handleBluePassMarketplaceMessage({
    tenantId,
    conversationId: conversation.id,
    content: input.content,
    priorTravellerMessages
  });

  const body = buildWhatsAppReplyBody(reply.assistantContent, reply.bluepassMatches);
  const suggestedReplies = resolveSuggestedReplies(reply);

  await createAssistantMessage({
    tenantId,
    conversationId: conversation.id,
    content: body
  });

  try {
    // One-tap: when Kai offers next steps, send them as interactive reply
    // buttons (valid here — the reply always answers an inbound message, so
    // we're inside the 24h window). sendWhatsAppInteractiveButtons falls back
    // to a plain text send when there are no usable buttons.
    const sent =
      suggestedReplies.length > 0
        ? await sendWhatsAppInteractiveButtons({ to: whatsappPhone, body, role: "kai", buttons: suggestedReplies })
        : await sendWhatsAppText({ to: whatsappPhone, body, role: "kai" });
    return {
      status: "REPLIED",
      conversationId: conversation.id,
      providerMessageId: sent.providerMessageId
    };
  } catch (error) {
    return {
      status: "SEND_FAILED",
      conversationId: conversation.id,
      reason: error instanceof Error ? error.message : "WhatsApp send failed."
    };
  }
}

/**
 * Business-app coexistence echo — a human replied to this customer from the
 * phone app, so the concierge yields the thread.
 */
export async function markBluePassWhatsAppHumanTakeover(input: { customerPhone: string }) {
  const tenantId = resolveBluePassWhatsAppTenantId();
  if (!tenantId) return null;

  return setWhatsAppConversationControlMode({
    tenantId,
    whatsappPhone: normalizePhone(input.customerPhone),
    controlMode: "HUMAN"
  });
}

export function resolveBluePassWhatsAppTenantId() {
  return process.env.BLUEPASS_WHATSAPP_TENANT_ID?.trim() || null;
}

/**
 * The widget renders yacht matches as cards; WhatsApp has no card surface, so
 * append the top matches as compact lines.
 */
export function buildWhatsAppReplyBody(assistantContent: string, matches: BluePassYachtCard[]) {
  if (matches.length === 0) return assistantContent;

  const lines = matches
    .slice(0, 2)
    .map((match) => `${match.name} — ${match.region} · ${match.priceSignal}${match.productUrl ? `\n${match.productUrl}` : ""}`);

  return `${assistantContent}\n\n${lines.join("\n")}`;
}

/**
 * Pull Kai's suggested next steps off a marketplace reply (only some branches
 * carry them). Read defensively — the reply is a union whose members differ —
 * and cap at Meta's 3-button limit.
 */
function resolveSuggestedReplies(reply: unknown): BluePassSuggestedReply[] {
  const suggested = (reply as { suggestedReplies?: BluePassSuggestedReply[] }).suggestedReplies;
  if (!Array.isArray(suggested)) return [];

  return suggested
    .filter(
      (item): item is BluePassSuggestedReply =>
        Boolean(item) && typeof item.id === "string" && typeof item.title === "string" && item.title.trim().length > 0
    )
    .slice(0, 3);
}

function normalizePhone(value: string) {
  return value.trim().replace(/[^\d]/g, "");
}
