import { NextRequest, NextResponse } from "next/server";
import {
  createAssistantMessage,
  createManualInquiry,
  createTravellerMessage,
  findConversationBookingState,
  findTenantConversation,
  listRecentConversationMessages,
  listRecentTravellerMessageContents
} from "@/server/conversation/conversation-repository";
import { runGenericBookingTurn } from "@/server/booking/generic-booking-turn";
import { createAssistantLlmClient } from "@/server/llm/assistant-llm-client";
import { createGenericBookingRouterClient } from "@/server/llm/generic-booking-router-client";
import { createBluePassRouterClient } from "@/server/llm/bluepass-router-client";
import { handleBluePassMarketplaceMessage } from "@/server/bluepass/bluepass-message-flow";
import { composeBluePassMarketplaceAssistantReply } from "@/server/bluepass/bluepass-marketplace-reply-composer";
import { shouldPolishBluePassMarketplaceReply } from "@/server/bluepass/bluepass-marketplace-reply-gate";
import type { BluePassCatalogSnapshotItem } from "@/core/bluepass/catalog";
import { WHATSAPP_GENERIC_ELIGIBLE_FEATURE } from "@/core/tenant/feature-flags";
import { resolveTenantBusinessPack } from "@/server/business-pack/resolve-tenant-business-pack";
import { getWidgetRequestOrigin } from "@/server/widget/request-origin";
import { resolveWidgetRequest } from "@/server/widget/resolve-widget-request";
import {
  buildAuOperatorRecommendationReply,
  buildTenantProductsHandoffReply,
  listAuRecommendationCandidates,
  resolveAuOperatorRecommendationSelection
} from "@/server/whatsapp/au-operator-recommendation";
import { shouldUseGenericBookingFlow } from "./business-pack-gate";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    key?: string;
    conversationId?: string;
    content?: string;
    referral?: {
      referralPartnerId?: string | null;
      referralLinkId?: string | null;
      referralCode?: string | null;
      referralRole?: string | null;
    } | null;
    bluepassCatalog?: BluePassCatalogSnapshotItem[];
  } | null;

  if (!body?.key) {
    return NextResponse.json(
      {
        error: {
          code: "WIDGET_KEY_REQUIRED",
          message: "Missing widget key."
        }
      },
      { status: 400 }
    );
  }

  if (!body.conversationId) {
    return NextResponse.json(
      {
        error: {
          code: "CONVERSATION_REQUIRED",
          message: "Missing conversation id."
        }
      },
      { status: 400 }
    );
  }

  const content = body.content?.trim();
  if (!content) {
    return NextResponse.json(
      {
        error: {
          code: "MESSAGE_CONTENT_REQUIRED",
          message: "Message content is required."
        }
      },
      { status: 400 }
    );
  }

  const resolved = await resolveWidgetRequest({
    widgetKey: body.key,
    origin: getWidgetRequestOrigin(request)
  });

  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const conversation = await findTenantConversation({
    tenantId: resolved.tenant.id,
    conversationId: body.conversationId
  });

  if (!conversation) {
    return NextResponse.json(
      {
        error: {
          code: "CONVERSATION_NOT_FOUND",
          message: "No conversation exists for this tenant."
        }
      },
      { status: 404 }
    );
  }

  const businessPack = resolveTenantBusinessPack(resolved.tenant);

  if (!shouldUseGenericBookingFlow(businessPack)) {
    const priorTravellerMessages = await listRecentTravellerMessageContents({
      tenantId: resolved.tenant.id,
      conversationId: conversation.id
    });
    const message = await createTravellerMessage({
      tenantId: resolved.tenant.id,
      conversationId: conversation.id,
      content
    });
    const bluepassResult = await handleBluePassMarketplaceMessage({
      tenantId: resolved.tenant.id,
      conversationId: conversation.id,
      content,
      priorTravellerMessages,
      referral: body.referral ?? null,
      catalog: body.bluepassCatalog,
      routerClient: createBluePassRouterClient(process.env)
    });
    const priorConversationMessages = await listRecentConversationMessages({
      tenantId: resolved.tenant.id,
      conversationId: conversation.id
    });
    const shouldPolish = shouldPolishBluePassMarketplaceReply({
      persona: bluepassResult.persona,
      replyMode: bluepassResult.replyMode
    });
    console.log(shouldPolish ? "bluepass_llm.polish_call_made" : "bluepass_llm.polish_call_skipped", {
      channel: "widget",
      persona: bluepassResult.persona,
      replyMode: bluepassResult.replyMode
    });

    const composedBluePassReply = await composeBluePassMarketplaceAssistantReply({
      deterministicReply: bluepassResult.assistantContent,
      latestMessage: content,
      conversationHistory: priorConversationMessages,
      llmClient: shouldPolish ? createAssistantLlmClient(process.env) : null,
      marketplaceResult: bluepassResult,
      catalogInput: body.bluepassCatalog
    });

    const assistantMessage = await createAssistantMessage({
      tenantId: resolved.tenant.id,
      conversationId: conversation.id,
      content: composedBluePassReply.reply
    });

    return NextResponse.json({
      message: {
        id: message.id,
        tenantSlug: resolved.tenant.slug,
        conversationId: message.conversationId,
        role: message.role,
        content: message.content
      },
      assistantMessage: {
        id: assistantMessage.id,
        tenantSlug: resolved.tenant.slug,
        conversationId: assistantMessage.conversationId,
        role: assistantMessage.role,
        content: assistantMessage.content
      },
      businessPack: {
        kind: businessPack.kind,
        paymentPolicy: businessPack.paymentPolicy,
        truthPolicy: businessPack.truthPolicy
      },
      bluepassMatches: bluepassResult.bluepassMatches,
      bluepassInquiry: bluepassResult.bluepassInquiry
        ? {
            id: bluepassResult.bluepassInquiry.id,
            tenantSlug: resolved.tenant.slug,
            conversationId: bluepassResult.bluepassInquiry.conversationId,
            status: bluepassResult.bluepassInquiry.status,
            destination: bluepassResult.bluepassInquiry.destination,
            tripType: bluepassResult.bluepassInquiry.tripType,
            dateWindow: bluepassResult.bluepassInquiry.dateWindow,
            guests: bluepassResult.bluepassInquiry.guests,
            budget: bluepassResult.bluepassInquiry.budget,
            selectedYachtSlug: bluepassResult.bluepassInquiry.selectedYachtSlug,
            selectedYachtName: bluepassResult.bluepassInquiry.selectedYachtName,
            travellerName: bluepassResult.bluepassInquiry.travellerName,
            travellerEmail: bluepassResult.bluepassInquiry.travellerEmail,
            travellerPhone: bluepassResult.bluepassInquiry.travellerPhone,
            referralCode: bluepassResult.bluepassInquiry.referralCode
          }
        : null,
      bluepassLedger: bluepassResult.bluepassLedger.map((entry) => ({
        id: entry.id,
        tenantSlug: resolved.tenant.slug,
        conversationId: entry.conversationId,
        kind: entry.kind,
        amountCents: entry.amountCents,
        currency: entry.currency,
        status: entry.status,
        referralCode: entry.referralCode
      })),
      bluepassDispatch: bluepassResult.bluepassDispatch
        ? {
            id: bluepassResult.bluepassDispatch.id,
            tenantSlug: resolved.tenant.slug,
            conversationId: bluepassResult.bluepassDispatch.conversationId,
            status: bluepassResult.bluepassDispatch.status,
            operatorId: bluepassResult.bluepassDispatch.operatorId,
            operatorName: bluepassResult.bluepassDispatch.operatorName,
            operatorPhone: bluepassResult.bluepassDispatch.operatorPhone
          }
        : null,
      manualInquiry: null,
      paymentRequest: null,
      contactRequest: bluepassResult.contactRequest
        ? {
            conversationId: conversation.id,
            fields: bluepassResult.contactRequest.fields,
            status: bluepassResult.contactRequest.status
          }
        : null
    });
  }

  const previousBookingState = await findConversationBookingState({
    tenantId: resolved.tenant.id,
    conversationId: conversation.id
  });
  const priorTravellerMessages = await listRecentTravellerMessageContents({
    tenantId: resolved.tenant.id,
    conversationId: conversation.id
  });
  const priorConversationMessages = await listRecentConversationMessages({
    tenantId: resolved.tenant.id,
    conversationId: conversation.id
  });

  // AU recommend-then-pick moment, mirrored from the WhatsApp side (au-operator-recommendation.ts):
  // scoped to widget tenants themselves flagged eligible for the shared recommendation (same flag
  // WhatsApp's explicit-match tier uses), so no other generic-flow tenant is affected, and the
  // candidate list (real + placeholder operators) is identical across both channels.
  const tenantConfigForAuRecommendation = resolved.tenant.config;
  if (tenantConfigForAuRecommendation?.enabledFeatures?.includes(WHATSAPP_GENERIC_ELIGIBLE_FEATURE)) {
    const candidates = await listAuRecommendationCandidates();

    if (candidates.length > 0) {
      const lastAssistantMessage =
        [...priorConversationMessages].reverse().find((entry) => entry.role === "assistant")?.content ?? null;
      const picked = resolveAuOperatorRecommendationSelection({
        lastAssistantMessage,
        message: content,
        candidates
      });

      if (picked) {
        const message = await createTravellerMessage({
          tenantId: resolved.tenant.id,
          conversationId: conversation.id,
          content
        });
        const reply = picked.isPlaceholder
          ? `Sorry, ${picked.name} is not available right now - want to try one of the other options instead?`
          : picked.tenantId === resolved.tenant.id && tenantConfigForAuRecommendation
            ? // Shows this tenant's actual live product list right away (same numbered "- live
              // availability" format used everywhere else), instead of a vague "what would you like
              // to explore?" the traveller has no way to answer without already knowing the catalog.
              await buildTenantProductsHandoffReply({
                id: resolved.tenant.id,
                slug: resolved.tenant.slug,
                name: resolved.tenant.name,
                config: tenantConfigForAuRecommendation
              })
            : // Picking a different real operator than the one this widget is already bound to isn't
              // wired up yet (no cross-tenant hand-off on the website today) - say so honestly rather
              // than silently mishandling it.
              `I can only help with ${resolved.tenant.name} directly from this site right now - want to continue with them?`;
        const assistantMessage = await createAssistantMessage({
          tenantId: resolved.tenant.id,
          conversationId: conversation.id,
          content: reply
        });

        return NextResponse.json({
          message: {
            id: message.id,
            tenantSlug: resolved.tenant.slug,
            conversationId: message.conversationId,
            role: message.role,
            content: message.content
          },
          assistantMessage: {
            id: assistantMessage.id,
            tenantSlug: resolved.tenant.slug,
            conversationId: assistantMessage.conversationId,
            role: assistantMessage.role,
            content: assistantMessage.content
          },
          manualInquiry: null,
          paymentRequest: null,
          contactRequest: null
        });
      }

      if (priorConversationMessages.length === 0) {
        const message = await createTravellerMessage({
          tenantId: resolved.tenant.id,
          conversationId: conversation.id,
          content
        });
        const assistantMessage = await createAssistantMessage({
          tenantId: resolved.tenant.id,
          conversationId: conversation.id,
          content: buildAuOperatorRecommendationReply(candidates)
        });

        return NextResponse.json({
          message: {
            id: message.id,
            tenantSlug: resolved.tenant.slug,
            conversationId: message.conversationId,
            role: message.role,
            content: message.content
          },
          assistantMessage: {
            id: assistantMessage.id,
            tenantSlug: resolved.tenant.slug,
            conversationId: assistantMessage.conversationId,
            role: assistantMessage.role,
            content: assistantMessage.content
          },
          manualInquiry: null,
          paymentRequest: null,
          contactRequest: null
        });
      }
    }
  }

  const message = await createTravellerMessage({
    tenantId: resolved.tenant.id,
    conversationId: conversation.id,
    content
  });

  const llmClient = createAssistantLlmClient(process.env);
  const routerClient = createGenericBookingRouterClient(process.env);

  const { assistantContent, manualInquiry, paymentRequest, contactRequest } = await runGenericBookingTurn({
    tenant: resolved.tenant,
    conversationId: conversation.id,
    content,
    previousBookingState,
    priorTravellerMessages,
    priorConversationMessages,
    llmClient,
    routerClient
  });

  const assistantMessage = await createAssistantMessage({
    tenantId: resolved.tenant.id,
    conversationId: conversation.id,
    content: assistantContent
  });

  return NextResponse.json({
    message: {
      id: message.id,
      tenantSlug: resolved.tenant.slug,
      conversationId: message.conversationId,
      role: message.role,
      content: message.content
    },
    assistantMessage: {
      id: assistantMessage.id,
      tenantSlug: resolved.tenant.slug,
      conversationId: assistantMessage.conversationId,
      role: assistantMessage.role,
      content: assistantMessage.content
    },
    manualInquiry: manualInquiry
      ? {
          id: manualInquiry.id,
          tenantSlug: resolved.tenant.slug,
          conversationId: manualInquiry.conversationId,
          status: manualInquiry.status,
          productExternalId: manualInquiry.productExternalId,
          productTitle: manualInquiry.productTitle,
          dateText: manualInquiry.dateText,
          guests: manualInquiry.guests,
          travellerName: manualInquiry.travellerName,
          travellerEmail: manualInquiry.travellerEmail,
          travellerPhone: manualInquiry.travellerPhone
        }
      : null,
    paymentRequest,
    contactRequest
  });
}
