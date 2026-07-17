import { runGenericBookingTurn, type GenericBookingTurnTenant } from "@/server/booking/generic-booking-turn";
import {
  createAssistantMessage,
  createTravellerMessage,
  findConversationBookingState,
  findOrCreateWhatsAppConversation,
  listRecentConversationMessages,
  listRecentTravellerMessageContents
} from "@/server/conversation/conversation-repository";
import { createAssistantLlmClient } from "@/server/llm/assistant-llm-client";
import { createGenericBookingRouterClient } from "@/server/llm/generic-booking-router-client";
import { normalizeLocalPhone } from "@/server/phone/normalize-local-phone";
import { sendWhatsAppText } from "@/server/whatsapp/client";
import type { WhatsAppInboundTextMessage } from "@/server/whatsapp/webhook";

type GenericWhatsAppInboundResult = {
  handled: boolean;
  sent: boolean;
  reply: string | null;
};

// WhatsApp-side mirror of the web widget's generic-booking-flow branch
// (src/app/api/widget/messages/route.ts) - same shared runGenericBookingTurn core, same
// conversation-repository helpers, just a text-channel caller instead of a JSON responder.
export async function handleGenericWhatsAppInboundMessage(
  input: WhatsAppInboundTextMessage,
  tenant: GenericBookingTurnTenant
): Promise<GenericWhatsAppInboundResult> {
  const travellerPhone = normalizeLocalPhone(input.from);
  const conversation = await findOrCreateWhatsAppConversation({
    tenantId: tenant.id,
    whatsappPhone: travellerPhone
  });

  const [previousBookingState, priorTravellerMessages, priorConversationMessages] = await Promise.all([
    findConversationBookingState({ tenantId: tenant.id, conversationId: conversation.id }),
    listRecentTravellerMessageContents({ tenantId: tenant.id, conversationId: conversation.id }),
    listRecentConversationMessages({ tenantId: tenant.id, conversationId: conversation.id })
  ]);

  await createTravellerMessage({
    tenantId: tenant.id,
    conversationId: conversation.id,
    content: input.body
  });

  const { assistantContent } = await runGenericBookingTurn({
    tenant,
    conversationId: conversation.id,
    content: input.body,
    previousBookingState,
    priorTravellerMessages,
    priorConversationMessages,
    llmClient: createAssistantLlmClient(process.env),
    routerClient: createGenericBookingRouterClient(process.env)
  });

  await createAssistantMessage({
    tenantId: tenant.id,
    conversationId: conversation.id,
    content: assistantContent
  });

  await sendWhatsAppText({
    to: input.from,
    role: "kai",
    body: assistantContent
  });

  return {
    handled: true,
    sent: true,
    reply: assistantContent
  };
}
