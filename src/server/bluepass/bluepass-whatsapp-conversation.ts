import {
  buildBluePassResetConversationReply,
  isBluePassResetConversationRequest,
  normalizeBluePassConversationText
} from "@/core/bluepass/conversation-intent";
import { prisma } from "@/lib/prisma";
import {
  createAssistantMessage,
  createTravellerMessage,
  listRecentConversationMessages,
  listRecentTravellerMessageContents
} from "@/server/conversation/conversation-repository";
import { createAssistantLlmClient } from "@/server/llm/assistant-llm-client";
import { createBluePassRouterClient } from "@/server/llm/bluepass-router-client";
import type { WhatsAppInboundTextMessage } from "@/server/whatsapp/webhook";
import { sendWhatsAppImage, sendWhatsAppText } from "@/server/whatsapp/client";
import { handleBluePassMarketplaceMessage } from "./bluepass-message-flow";
import {
  findLatestBluePassParticipantContext,
  handleBluePassWhatsAppContextMessage
} from "./bluepass-inquiry-repository";
import {
  resolveBluePassOperatorDirectoryIdentityByPhone,
  resolveBluePassPartnerDirectoryIdentityByPhone
} from "./bluepass-operator-directory";
import { composeBluePassMarketplaceAssistantReply } from "./bluepass-marketplace-reply-composer";

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
  const directoryIdentity = await resolveBluePassOperatorDirectoryIdentityByPhone(input.from);
  const partnerDirectoryIdentity = directoryIdentity
    ? null
    : await resolveBluePassPartnerDirectoryIdentityByPhone(input.from);
  const identityPersona = directoryIdentity?.persona ?? partnerDirectoryIdentity?.persona ?? null;
  const identityName = directoryIdentity?.operatorName ?? partnerDirectoryIdentity?.partnerName ?? null;

  if (isBluePassResetConversationRequest(input.body)) {
    return handleBluePassTravellerMarketplaceWhatsAppMessage(input, {
      resetConversation: true,
      identityPersona,
      identityName,
      overrideAssistantContent: buildBluePassResetConversationReply({
        persona: identityPersona,
        identityName
      })
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

  return handleBluePassTravellerMarketplaceWhatsAppMessage(input, {
    identityPersona,
    identityName
  });
}

function shouldRouteOperatorMessageToContext(body: string) {
  const normalized = normalizeMessage(body);
  if (!normalized) return false;
  if (isBluePassResetConversationRequest(normalized)) return false;

  return [
    /\b(?:what should i send|what do i send|how should i reply|how should i respond|what now|next step|help with this inquiry)\b/,
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
  if (isBluePassResetConversationRequest(normalized)) return false;

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
  return normalizeBluePassConversationText(body);
}

async function handleBluePassTravellerMarketplaceWhatsAppMessage(
  input: WhatsAppInboundTextMessage,
  options: {
    resetConversation?: boolean;
    overrideAssistantContent?: string;
    identityPersona?: "OPERATOR" | "PARTNER" | "TRAVELLER" | "UNKNOWN" | null;
    identityName?: string | null;
  } = {}
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

  const routerClient = createBluePassRouterClient(process.env);
  console.log("bluepass_whatsapp.llm_router_client", {
    enabled: routerClient !== null,
    ENABLE_LLM: process.env.ENABLE_LLM ?? null,
    ENABLE_OPENAI_LLM: process.env.ENABLE_OPENAI_LLM ?? null,
    LLM_PROVIDER: process.env.LLM_PROVIDER ?? null,
    hasGroqKey: Boolean(process.env.GROQ_API_KEY?.trim()),
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY?.trim())
  });

  const result = options.overrideAssistantContent
    ? null
    : await handleBluePassMarketplaceMessage({
        tenantId: tenant.id,
        conversationId: conversation.id,
        content: input.body,
        priorTravellerMessages,
        travellerPhone,
        identityPersona: options.identityPersona,
        identityName: options.identityName,
        routerClient
      });
  const assistantContent =
    options.overrideAssistantContent ??
    (await composeBluePassMarketplaceWhatsAppReply({
      tenantId: tenant.id,
      conversationId: conversation.id,
      deterministicReply: result!.assistantContent,
      latestMessage: input.body,
      marketplaceResult: result!
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

  const featuredYacht = result?.bluepassMatches?.[0];
  if (featuredYacht?.imageUrl) {
    const caption = featuredYacht.productUrl
      ? `${featuredYacht.name} — ${featuredYacht.productUrl}`
      : featuredYacht.name;

    await sendWhatsAppImage({
      to: input.from,
      role: "kai",
      imageUrl: featuredYacht.imageUrl,
      caption
    }).catch((error) => {
      console.warn("bluepass_whatsapp.image_send_failed", {
        yachtSlug: featuredYacht.slug,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

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
  marketplaceResult: Awaited<ReturnType<typeof handleBluePassMarketplaceMessage>>;
}) {
  const llmClient = createAssistantLlmClient(process.env);
  const history = await listRecentConversationMessages({
    tenantId: input.tenantId,
    conversationId: input.conversationId
  });

  const result = await composeBluePassMarketplaceAssistantReply({
    deterministicReply: input.deterministicReply,
    latestMessage: input.latestMessage,
    conversationHistory: history,
    llmClient,
    marketplaceResult: input.marketplaceResult
  });

  return result.reply;
}

function normalizeWhatsAppSender(value: string) {
  const digits = value.trim().replace(/[^\d]/g, "");
  return digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
}
