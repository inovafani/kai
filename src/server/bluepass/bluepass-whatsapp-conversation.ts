import { composeAssistantReply } from "@/core/llm/assistant-reply-composer";
import { prisma } from "@/lib/prisma";
import {
  createAssistantMessage,
  createTravellerMessage,
  listRecentConversationMessages,
  listRecentTravellerMessageContents
} from "@/server/conversation/conversation-repository";
import { createAssistantLlmClient } from "@/server/llm/assistant-llm-client";
import type { WhatsAppInboundTextMessage } from "@/server/whatsapp/webhook";
import { sendWhatsAppText } from "@/server/whatsapp/client";
import { handleBluePassMarketplaceMessage } from "./bluepass-message-flow";
import {
  findLatestBluePassParticipantContext,
  handleBluePassWhatsAppContextMessage
} from "./bluepass-inquiry-repository";

type BluePassWhatsAppInboundResult = {
  handled: boolean;
  sent: boolean;
  reply: string | null;
};

const defaultBluePassTenantSlug = "bluepass";

export async function handleBluePassWhatsAppInboundMessage(
  input: WhatsAppInboundTextMessage
): Promise<BluePassWhatsAppInboundResult> {
  const context = await findLatestBluePassParticipantContext(input.from);

  if (isNewChatRequest(input.body)) {
    return handleBluePassTravellerMarketplaceWhatsAppMessage(input, {
      resetConversation: true,
      overrideAssistantContent:
        "Fresh chat started. I can help compare BluePass liveaboards, recommend Komodo or Raja Ampat options, or prepare a new operator inquiry when you are ready."
    });
  }

  const shouldRouteToContext =
    context?.participant === "operator"
      ? shouldRouteOperatorMessageToContext(input.body)
      : shouldRouteTravellerMessageToContext(input.body, context?.inquiry.status);

  if (shouldRouteToContext) {
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

function isNewChatRequest(body: string) {
  const normalized = normalizeMessage(body);

  return /^(?:new chat|fresh chat|start over|restart|reset|reset chat|clear chat|mulai baru|chat baru|ulang dari awal)$/.test(
    normalized
  );
}

function shouldRouteOperatorMessageToContext(body: string) {
  const normalized = normalizeMessage(body);
  if (!normalized) return false;
  if (isNewChatRequest(normalized)) return false;

  return [
    /\b(?:accept|accepted|available|availability|confirmed|confirm|ok to proceed)\b/,
    /\b(?:decline|declined|unavailable|not available|full|sold out|cannot|can't|cant)\b/,
    /\b(?:counter|counteroffer|counter-offer|alternative date|different date)\b/,
    /\b(?:price|rate|quote|final price|cost|usd|idr|deposit|payment|invoice|payment link)\b/,
    /\b(?:hold|held|slot|booking confirmation|confirmed booking|reservation)\b/
  ].some((pattern) => pattern.test(normalized));
}

function shouldRouteTravellerMessageToContext(body: string, inquiryStatus?: string | null) {
  const normalized = normalizeMessage(body);
  if (!normalized) return false;
  if (isNewChatRequest(normalized)) return false;

  if (inquiryStatus === "DECLINED" && /\b(?:yes|yep|yeah|ok|okay|sure|please|go ahead|proceed|send|submit|try)\b/.test(normalized)) {
    return true;
  }

  return [
    /\b(?:status|update|operator replied|operator response|any news|what happened)\b/,
    /\b(?:confirmed yet|booking confirmed|is my booking confirmed|already confirmed)\b/,
    /\b(?:payment|pay|deposit|invoice|payment link|quote link|quote status)\b/,
    /\b(?:my inquiry|latest inquiry|current inquiry|existing inquiry)\b/
  ].some((pattern) => pattern.test(normalized));
}

function normalizeMessage(body: string) {
  return body.toLowerCase().replace(/\s+/g, " ").trim();
}

async function handleBluePassTravellerMarketplaceWhatsAppMessage(
  input: WhatsAppInboundTextMessage,
  options: { resetConversation?: boolean; overrideAssistantContent?: string } = {}
) {
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
  const existingConversation = options.resetConversation
    ? null
    : await prisma.conversation.findFirst({
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

  const priorTravellerMessages = options.resetConversation
    ? []
    : await listRecentTravellerMessageContents({
        tenantId: tenant.id,
        conversationId: conversation.id
      });

  await createTravellerMessage({
    tenantId: tenant.id,
    conversationId: conversation.id,
    content: input.body
  });

  const result = options.overrideAssistantContent
    ? null
    : await handleBluePassMarketplaceMessage({
        tenantId: tenant.id,
        conversationId: conversation.id,
        content: input.body,
        priorTravellerMessages,
        travellerPhone
      });
  const assistantContent =
    options.overrideAssistantContent ??
    (await composeBluePassMarketplaceWhatsAppReply({
      tenantId: tenant.id,
      conversationId: conversation.id,
      deterministicReply: result!.assistantContent,
      latestMessage: input.body,
      requiredFacts: buildMarketplaceRequiredFacts(result!),
      productTitles: [
        result!.bluepassInquiry?.selectedYachtName,
        result!.bluepassInquiry?.operatorName,
        ...result!.bluepassMatches.map((match) => match.name)
      ].filter((value): value is string => Boolean(value))
    }));

  await createAssistantMessage({
    tenantId: tenant.id,
    conversationId: conversation.id,
    content: assistantContent
  });

  const sendResult = await sendWhatsAppText({
    to: input.from,
    role: "kai",
    body: assistantContent
  });

  if (result?.bluepassInquiry) {
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
    reply: assistantContent
  };
}

async function composeBluePassMarketplaceWhatsAppReply(input: {
  tenantId: string;
  conversationId: string;
  deterministicReply: string;
  latestMessage: string;
  requiredFacts: string[];
  productTitles: string[];
}) {
  const llmClient = createAssistantLlmClient(process.env);
  const history = await listRecentConversationMessages({
    tenantId: input.tenantId,
    conversationId: input.conversationId
  });
  const result = await composeAssistantReply({
    deterministicReply: input.deterministicReply,
    requiredFacts: input.requiredFacts,
    latestUserMessage: input.latestMessage,
    conversationHistory: history,
    llmClient,
    tenantContext: {
      tenantName: "BluePass",
      brandVoice:
        "Warm, natural marine travel concierge. Helpful like a human travel advisor, but concise and honest about operator confirmation.",
      pmsProvider: "BluePass marketplace catalog and operator network",
      responseGuardrails: [
        "Do not confirm live availability, final price, payment, or booking before operator confirmation.",
        "Do not invent operator responses, prices, dates, payment links, or live availability.",
        "If the traveller asks general questions, answer helpfully before asking for booking details."
      ],
      productTitles: input.productTitles
    }
  });

  return result.reply;
}

function buildMarketplaceRequiredFacts(result: Awaited<ReturnType<typeof handleBluePassMarketplaceMessage>>) {
  const inquiry = result.bluepassInquiry;
  if (!inquiry) return [];

  return [
    inquiry.selectedYachtName,
    inquiry.destination,
    inquiry.dateWindow,
    inquiry.guests ? `${inquiry.guests}` : null
  ].filter((value): value is string => Boolean(value));
}

function normalizeWhatsAppSender(value: string) {
  const digits = value.trim().replace(/[^\d]/g, "");
  return digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
}
