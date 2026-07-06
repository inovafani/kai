import type { BluePassYachtCard } from "@/core/bluepass/catalog";
import {
  createAssistantMessage,
  createTravellerMessage,
  findOrCreateWhatsAppConversation,
  listRecentTravellerMessageContents,
  setWhatsAppConversationControlMode
} from "@/server/conversation/conversation-repository";
import { sendWhatsAppText } from "@/server/whatsapp/client";
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

  await createAssistantMessage({
    tenantId,
    conversationId: conversation.id,
    content: body
  });

  try {
    const sent = await sendWhatsAppText({ to: whatsappPhone, body, role: "kai" });
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

function normalizePhone(value: string) {
  return value.trim().replace(/[^\d]/g, "");
}
