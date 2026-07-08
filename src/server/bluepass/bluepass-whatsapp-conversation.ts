import { prisma } from "@/lib/prisma";
import {
  createAssistantMessage,
  createTravellerMessage,
  listRecentTravellerMessageContents
} from "@/server/conversation/conversation-repository";
import type { WhatsAppInboundTextMessage } from "@/server/whatsapp/webhook";
import { sendWhatsAppText } from "@/server/whatsapp/client";
import { handleBluePassMarketplaceMessage } from "./bluepass-message-flow";
import { handleBluePassWhatsAppContextMessage } from "./bluepass-inquiry-repository";

type BluePassWhatsAppInboundResult = {
  handled: boolean;
  sent: boolean;
  reply: string | null;
};

const defaultBluePassTenantSlug = "bluepass";

export async function handleBluePassWhatsAppInboundMessage(
  input: WhatsAppInboundTextMessage
): Promise<BluePassWhatsAppInboundResult> {
  if (!shouldRouteToMarketplace(input.body)) {
    const contextResult = await handleBluePassWhatsAppContextMessage(input);
    if (contextResult.handled) {
      return {
        handled: true,
        sent: contextResult.sent,
        reply: contextResult.reply
      };
    }
  }

  return handleBluePassTravellerMarketplaceWhatsAppMessage(input);
}

function shouldRouteToMarketplace(body: string) {
  const normalized = body.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  return [
    /\b(i want|i need|can you help me|help me|please help).{0,80}\b(book|booking|order|reserve|inquiry|trip|liveaboard|yacht)\b/,
    /\b(book|booking|order|reserve)\b.{0,80}\b(yacht|liveaboard|trip|komodo|raja ampat|calico jack|alila purnama|alilikai|samsara)\b/,
    /\b(recommend|recommendation|suggest|option|options|alternative|alternatives)\b.{0,80}\b(for me|komodo|raja ampat|yacht|liveaboard|trip|diving|sailing|cruising)\b/
  ].some((pattern) => pattern.test(normalized));
}

async function handleBluePassTravellerMarketplaceWhatsAppMessage(input: WhatsAppInboundTextMessage) {
  const tenant = await prisma.tenant.findFirst({
    where: {
      slug: process.env.WHATSAPP_BLUEPASS_TENANT_SLUG?.trim() || defaultBluePassTenantSlug,
      status: "ACTIVE"
    }
  });

  if (!tenant) {
    return {
      handled: false as const,
      sent: false as const,
      reply: null
    };
  }

  const travellerPhone = normalizeWhatsAppSender(input.from);
  const existingConversation = await prisma.conversation.findFirst({
    where: {
      tenantId: tenant.id,
      channel: "WHATSAPP",
      travellerId: travellerPhone
    },
    orderBy: { updatedAt: "desc" }
  });
  const conversation =
    existingConversation ??
    (await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        channel: "WHATSAPP",
        controlMode: "AI",
        travellerId: travellerPhone
      }
    }));

  const priorTravellerMessages = await listRecentTravellerMessageContents({
    tenantId: tenant.id,
    conversationId: conversation.id
  });

  await createTravellerMessage({
    tenantId: tenant.id,
    conversationId: conversation.id,
    content: input.body
  });

  const result = await handleBluePassMarketplaceMessage({
    tenantId: tenant.id,
    conversationId: conversation.id,
    content: input.body,
    priorTravellerMessages
  });

  await createAssistantMessage({
    tenantId: tenant.id,
    conversationId: conversation.id,
    content: result.assistantContent
  });

  const sendResult = await sendWhatsAppText({
    to: input.from,
    role: "kai",
    body: result.assistantContent
  });

  if (result.bluepassInquiry) {
    await prisma.bluePassInquiryEvent.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        bluePassInquiryId: result.bluepassInquiry.id,
        type: "WHATSAPP_CONTEXT_REPLY_SENT",
        fromStatus: result.bluepassInquiry.status,
        toStatus: result.bluepassInquiry.status,
        metadata: {
          participant: "traveller",
          inboundProviderMessageId: input.providerMessageId ?? null,
          providerMessageId: sendResult.providerMessageId,
          source: "bluepass_whatsapp_marketplace"
        }
      }
    });
  }

  return {
    handled: true as const,
    sent: true as const,
    reply: result.assistantContent
  };
}

function normalizeWhatsAppSender(value: string) {
  const digits = value.trim().replace(/[^\d]/g, "");
  return digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
}
