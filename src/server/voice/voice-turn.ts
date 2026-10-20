import { toSpokenReply } from "@/core/voice/spoken-reply";
import { prisma } from "@/lib/prisma";
import {
  createAssistantMessage,
  createTravellerMessage,
  findOrCreateWhatsAppConversation,
  listRecentConversationMessages,
  listRecentTravellerMessageContents
} from "@/server/conversation/conversation-repository";
import { createAssistantLlmClient } from "@/server/llm/assistant-llm-client";
import { createBluePassRouterClient } from "@/server/llm/bluepass-router-client";
import { normalizeLocalPhone } from "@/server/phone/normalize-local-phone";
import { composeBluePassMarketplaceAssistantReply } from "@/server/bluepass/bluepass-marketplace-reply-composer";
import { shouldPolishBluePassMarketplaceReply } from "@/server/bluepass/bluepass-marketplace-reply-gate";
import { handleBluePassMarketplaceMessage, readBluePassTeamSignals } from "@/server/bluepass/bluepass-message-flow";
import { alertTeam, teamAlertReasonFor } from "@/server/conversation/team-alert";

/**
 * One turn of a voice call with Kai. The voice itself (listening and speaking) belongs to the phone
 * agent; every word Kai says comes from the same brain as the WhatsApp and web chats, so a call
 * knows the same catalogue, the same enquiry and the same rules. A caller Kai already knows by
 * number carries on in their existing conversation, so a call and a chat are one thread.
 */
export type VoiceTurnMessage = { role: "system" | "user" | "assistant"; content: string };

export type VoiceTurnResult = {
  /** What Kai would write. */
  reply: string;
  /** The same answer, as it should be read out loud. */
  spoken: string;
  conversationId: string | null;
};

const defaultBluePassTenantSlug = "bluepass";

export async function runKaiVoiceTurn(input: {
  messages: VoiceTurnMessage[];
  /** The caller's number, so a call continues their existing chat. */
  callerPhone?: string | null;
}): Promise<VoiceTurnResult> {
  const latestMessage = [...input.messages].reverse().find((message) => message.role === "user")?.content?.trim();
  if (!latestMessage) {
    return { reply: "", spoken: "", conversationId: null };
  }

  const tenant = await prisma.tenant.findFirst({
    where: { slug: process.env.WHATSAPP_BLUEPASS_TENANT_SLUG?.trim() || defaultBluePassTenantSlug, status: "ACTIVE" }
  });
  if (!tenant) {
    throw new Error("No active BluePass tenant is configured for voice calls.");
  }

  const callerPhone = input.callerPhone?.trim() ? normalizeLocalPhone(input.callerPhone) : null;
  // A known number keeps its own thread; an unknown caller's turn runs off the history the phone
  // agent sends with the request, and isn't written to anyone's conversation.
  const conversation = callerPhone
    ? await findOrCreateWhatsAppConversation({ tenantId: tenant.id, whatsappPhone: callerPhone })
    : null;

  const priorTravellerMessages = conversation
    ? await listRecentTravellerMessageContents({ tenantId: tenant.id, conversationId: conversation.id })
    : input.messages.filter((message) => message.role === "user").map((message) => message.content).slice(0, -1);

  if (conversation) {
    await createTravellerMessage({ tenantId: tenant.id, conversationId: conversation.id, content: latestMessage });
  }

  const history = conversation
    ? await listRecentConversationMessages({ tenantId: tenant.id, conversationId: conversation.id })
    : input.messages.map((message) => ({
        role: message.role === "assistant" ? ("assistant" as const) : ("traveller" as const),
        content: message.content
      }));
  // The flow recognises a WhatsApp number, or a "yes" to Kai's offer of a person, only as an answer to
  // Kai's own last message, so it has to be told what that was. The chat routes pass it; the voice
  // turn didn't, so a caller who gave their number was answered with the boat list again (seen in
  // the first ElevenLabs test call, 2026-10-05).
  const priorAssistantMessages = history
    .filter((message) => message.role === "assistant")
    .map((message) => message.content);
  const lastAssistantMessage = priorAssistantMessages.at(-1) ?? null;

  const result = await handleBluePassMarketplaceMessage({
    tenantId: tenant.id,
    conversationId: conversation?.id ?? `voice-${tenant.id}`,
    content: latestMessage,
    priorTravellerMessages,
    lastAssistantMessage,
    priorAssistantMessages,
    travellerPhone: callerPhone,
    routerClient: createBluePassRouterClient(process.env)
  });

  // Kai tells the caller someone is on the way, or to call 000: the team has to hear about it too, or
  // that promise is empty. Started now so it runs while the reply is being polished, and awaited
  // below so a serverless function doesn't end before the alert is out.
  const teamSignals = readBluePassTeamSignals(result);
  const alertReason = teamAlertReasonFor(teamSignals);
  const alert = alertReason
    ? alertTeam({
        tenantId: tenant.id,
        conversationId: conversation?.id ?? null,
        reason: alertReason,
        channel: "voice",
        travellerPhone: callerPhone,
        callbackNumber: teamSignals.callbackNumber ?? null,
        latestMessage
      })
    : null;

  const shouldPolish = shouldPolishBluePassMarketplaceReply({ persona: result.persona, replyMode: result.replyMode });
  const composed = await composeBluePassMarketplaceAssistantReply({
    deterministicReply: result.assistantContent,
    latestMessage,
    conversationHistory: history,
    llmClient: shouldPolish ? createAssistantLlmClient(process.env) : null,
    marketplaceResult: result
  });

  if (conversation) {
    await createAssistantMessage({ tenantId: tenant.id, conversationId: conversation.id, content: composed.reply });
  }

  await alert;

  return { reply: composed.reply, spoken: toSpokenReply(composed.reply), conversationId: conversation?.id ?? null };
}
