import { composeAssistantReply } from "@/core/llm/assistant-reply-composer";
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
import type { WhatsAppInboundTextMessage } from "@/server/whatsapp/webhook";
import { sendWhatsAppText } from "@/server/whatsapp/client";
import { handleBluePassMarketplaceMessage } from "./bluepass-message-flow";
import {
  findLatestBluePassParticipantContext,
  handleBluePassWhatsAppContextMessage
} from "./bluepass-inquiry-repository";
import {
  resolveBluePassOperatorDirectoryIdentityByPhone,
  resolveBluePassPartnerDirectoryIdentityByPhone
} from "./bluepass-operator-directory";

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

  const result = options.overrideAssistantContent
    ? null
    : await handleBluePassMarketplaceMessage({
        tenantId: tenant.id,
        conversationId: conversation.id,
        content: input.body,
        priorTravellerMessages,
        travellerPhone,
        identityPersona: options.identityPersona,
        identityName: options.identityName
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
  const facts = [
    inquiry?.selectedYachtName,
    inquiry?.destination,
    inquiry?.dateWindow,
    inquiry?.guests ? `${inquiry.guests}` : null,
    ...result.bluepassMatches.map((match) => match.name),
    ...extractBluePassDeterministicFacts(result.assistantContent)
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(facts));
}

function normalizeWhatsAppSender(value: string) {
  const digits = value.trim().replace(/[^\d]/g, "");
  return digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
}

function extractBluePassDeterministicFacts(reply: string) {
  const facts: string[] = [];

  for (const match of reply.matchAll(/^\s*\d+\.\s+([A-Z][^-:\n]+?)\s+-/gm)) {
    facts.push(match[1].trim());
  }

  for (const pattern of [
    /\bfor\s+([A-Z][A-Za-z0-9' ]+?)\s+in\s+(?:Komodo|Raja Ampat)\b/g,
    /\bGreat choice\s+-\s+([A-Z][A-Za-z0-9' ]+?)\s+is\b/g,
    /^([A-Z][A-Za-z0-9' ]+?)\s+is\s+(?:a|an)\s+/gm
  ]) {
    for (const match of reply.matchAll(pattern)) {
      facts.push(match[1].trim());
    }
  }

  for (const match of reply.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    facts.push(match[0]);
  }

  for (const match of reply.matchAll(/\b(?:\+?62|0)\d{8,14}\b/g)) {
    facts.push(match[0]);
  }

  const contactMatch = reply.match(/\bContact details:\s*([^,\n.]+),/i);
  if (contactMatch) {
    facts.push(contactMatch[1].trim());
  }

  const tripMatch = reply.match(/\btrip details as\s+([^.\n]+)\./i);
  if (tripMatch) {
    const tripDetails = tripMatch[1];
    const dateMatch = tripDetails.match(/\b\d{1,2}\s+[A-Z][a-z]+(?:\s+\d{4})?\b/);
    const guestMatch = tripDetails.match(/\b\d{1,3}\s+guests?\b/i);

    if (dateMatch) facts.push(dateMatch[0]);
    if (guestMatch) facts.push(guestMatch[0]);
  }

  return facts;
}
