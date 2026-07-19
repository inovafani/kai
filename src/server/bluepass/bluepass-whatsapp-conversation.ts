import type { BluePassCatalogSnapshotItem } from "@/core/bluepass/catalog";
import {
  buildBluePassResetConversationReply,
  isBluePassResetConversationRequest,
  normalizeBluePassConversationText
} from "@/core/bluepass/conversation-intent";
import { resolveBluePassGate } from "@/core/bluepass/market";
import { prisma } from "@/lib/prisma";
import {
  createAssistantMessage,
  createTravellerMessage,
  findOrCreateWhatsAppConversation,
  listRecentConversationMessages,
  listRecentTravellerMessageContents,
  resetWhatsAppConversation
} from "@/server/conversation/conversation-repository";
import { createAssistantLlmClient } from "@/server/llm/assistant-llm-client";
import { createBluePassRouterClient } from "@/server/llm/bluepass-router-client";
import type { WhatsAppInboundTextMessage } from "@/server/whatsapp/webhook";
import { normalizeLocalPhone } from "@/server/phone/normalize-local-phone";
import { sendWhatsAppImage, sendWhatsAppInteractiveButtons, sendWhatsAppText } from "@/server/whatsapp/client";
import { handleBluePassMarketplaceMessage } from "./bluepass-message-flow";
import type { BluePassPersona } from "@/core/bluepass/triage";
import {
  findLatestBluePassParticipantContext,
  handleBluePassWhatsAppContextMessage
} from "./bluepass-inquiry-repository";
import {
  resolveBluePassOperatorDirectoryIdentityByPhone,
  resolveBluePassPartnerDirectoryIdentityByPhone
} from "./bluepass-operator-directory";
import { composeBluePassMarketplaceAssistantReply } from "./bluepass-marketplace-reply-composer";
import { shouldPolishBluePassMarketplaceReply } from "./bluepass-marketplace-reply-gate";

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
  // A phone with no directory entry can still be a known participant (it sent/received an
  // existing BluePassInquiry) - that's a real identity signal too, just weaker than a directory
  // match, so it only fills in when the directory lookups come back empty.
  const contextPersona: BluePassPersona | null =
    context?.participant === "operator" ? "OPERATOR" : context?.participant === "traveller" ? "TRAVELLER" : null;
  const identityPersona = directoryIdentity?.persona ?? partnerDirectoryIdentity?.persona ?? contextPersona;
  const identityName = directoryIdentity?.operatorName ?? partnerDirectoryIdentity?.partnerName ?? null;

  if (identityPersona) {
    console.log("bluepass_whatsapp.identity_directory_match", {
      identityPersona,
      identityName,
      operatorSlug: directoryIdentity?.operatorSlug ?? null,
      partnerId: partnerDirectoryIdentity?.partnerId ?? null
    });
  }

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
  const conversation = options.resetConversation
    ? await resetWhatsAppConversation({ tenantId: tenant.id, whatsappPhone: travellerPhone })
    : await findOrCreateWhatsAppConversation({ tenantId: tenant.id, whatsappPhone: travellerPhone });

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

  // Tony's country->region gate, WhatsApp-only: the web widget already asks this itself
  // (bluepass-app's own region-router, before ever calling Kai), so wiring it into the shared
  // bluepass-message-flow core would double-ask website travellers. A known directory identity
  // (registered operator/partner) skips the gate - their market comes from their own onboarding,
  // not a fresh "which country" question on every conversation.
  const gatePrompt =
    options.resetConversation || options.overrideAssistantContent || options.identityPersona
      ? null
      : resolveBluePassGate([...priorTravellerMessages, input.body]).prompt;
  const effectiveOverrideContent = options.overrideAssistantContent ?? gatePrompt ?? undefined;

  const routerClient = createBluePassRouterClient(process.env);
  console.log("bluepass_whatsapp.llm_router_client", {
    enabled: routerClient !== null,
    ENABLE_LLM: process.env.ENABLE_LLM ?? null,
    ENABLE_OPENAI_LLM: process.env.ENABLE_OPENAI_LLM ?? null,
    LLM_PROVIDER: process.env.LLM_PROVIDER ?? null,
    hasGroqKey: Boolean(process.env.GROQ_API_KEY?.trim()),
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY?.trim())
  });

  const catalog = effectiveOverrideContent ? undefined : await fetchBluePassCatalogSnapshot();

  const result = effectiveOverrideContent
    ? null
    : await handleBluePassMarketplaceMessage({
        tenantId: tenant.id,
        conversationId: conversation.id,
        content: input.body,
        priorTravellerMessages,
        travellerPhone,
        identityPersona: options.identityPersona,
        identityName: options.identityName,
        routerClient,
        catalog
      });
  const assistantContent =
    effectiveOverrideContent ??
    (await composeBluePassMarketplaceWhatsAppReply({
      tenantId: tenant.id,
      conversationId: conversation.id,
      deterministicReply: result!.assistantContent,
      latestMessage: input.body,
      marketplaceResult: result!,
      catalogInput: catalog
    }));

  await createAssistantMessage({
    tenantId: tenant.id,
    conversationId: conversation.id,
    content: assistantContent
  });

  const suggestedReplies = result?.suggestedReplies?.length ? result.suggestedReplies : null;
  const sendResult = suggestedReplies
    ? await sendWhatsAppInteractiveButtons({
        to: input.from,
        role: "kai",
        body: assistantContent,
        buttons: suggestedReplies
      })
    : await sendWhatsAppText({
        to: input.from,
        role: "kai",
        body: assistantContent
      });

  const featuredYacht = result?.bluepassMatches?.[0];
  console.log("bluepass_whatsapp.image_send_decision", {
    replyMode: result?.replyMode ?? null,
    matchCount: result?.bluepassMatches?.length ?? 0,
    featuredYachtSlug: featuredYacht?.slug ?? null,
    hasImageUrl: Boolean(featuredYacht?.imageUrl)
  });

  if (featuredYacht?.imageUrl) {
    const caption = featuredYacht.productUrl
      ? `${featuredYacht.name} — ${featuredYacht.productUrl}`
      : featuredYacht.name;

    await sendWhatsAppImage({
      to: input.from,
      role: "kai",
      imageUrl: featuredYacht.imageUrl,
      caption
    })
      .then((imageResult) => {
        console.log("bluepass_whatsapp.image_send_succeeded", {
          yachtSlug: featuredYacht.slug,
          providerMessageId: imageResult.providerMessageId
        });
      })
      .catch((error) => {
        console.warn("bluepass_whatsapp.image_send_failed", {
          yachtSlug: featuredYacht.slug,
          imageUrl: featuredYacht.imageUrl,
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
  catalogInput?: BluePassCatalogSnapshotItem[];
}) {
  const shouldPolish = shouldPolishBluePassMarketplaceReply({
    persona: input.marketplaceResult.persona,
    replyMode: input.marketplaceResult.replyMode
  });
  console.log(shouldPolish ? "bluepass_llm.polish_call_made" : "bluepass_llm.polish_call_skipped", {
    channel: "whatsapp",
    persona: input.marketplaceResult.persona,
    replyMode: input.marketplaceResult.replyMode
  });

  const llmClient = shouldPolish ? createAssistantLlmClient(process.env) : null;
  const history = await listRecentConversationMessages({
    tenantId: input.tenantId,
    conversationId: input.conversationId
  });

  const result = await composeBluePassMarketplaceAssistantReply({
    deterministicReply: input.deterministicReply,
    latestMessage: input.latestMessage,
    conversationHistory: history,
    llmClient,
    marketplaceResult: input.marketplaceResult,
    catalogInput: input.catalogInput
  });

  return result.reply;
}

const bluePassCatalogFetchTimeoutMs = 3000;

// WhatsApp messages hit kai's webhook directly and never pass through bluepass-app's own
// web-widget client, so this is the only path that gets kai's WhatsApp flow live operator-listing
// (and full yacht) data. Never throws - any failure (missing config, timeout, bad response) falls
// through to an empty array, which resolveBluePassCatalog() already treats identically to "no
// external catalog was ever sent" (its existing static preview-catalog fallback), so a
// bluepass-app outage degrades WhatsApp back to today's behavior rather than breaking it.
async function fetchBluePassCatalogSnapshot(): Promise<BluePassCatalogSnapshotItem[]> {
  // Explicit opt-in: several existing tests set BLUEPASS_APP_URL to a fake test domain (it's
  // already used elsewhere just to build display links), which would otherwise make every one of
  // them attempt a real, doomed-to-fail network call on every WhatsApp message. Requires this
  // separate flag once BLUEPASS_APP_URL is confirmed to point at a real deployment with the
  // catalog-snapshot route live.
  if (process.env.BLUEPASS_WHATSAPP_CATALOG_FETCH_ENABLED !== "true") return [];

  const baseUrl = process.env.BLUEPASS_APP_URL?.trim();
  if (!baseUrl) return [];

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), bluePassCatalogFetchTimeoutMs);

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/kai/catalog-snapshot`, {
      signal: abortController.signal
    });
    if (!response.ok) return [];

    const payload = (await response.json()) as { catalog?: BluePassCatalogSnapshotItem[] };
    return Array.isArray(payload.catalog) ? payload.catalog : [];
  } catch (error) {
    console.log("bluepass_whatsapp.catalog_snapshot_fetch_failed", {
      message: error instanceof Error ? error.message : String(error)
    });
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeWhatsAppSender(value: string) {
  return normalizeLocalPhone(value);
}
