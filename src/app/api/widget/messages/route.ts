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
import { resolveTenantBusinessPack } from "@/server/business-pack/resolve-tenant-business-pack";
import { getWidgetRequestOrigin } from "@/server/widget/request-origin";
import { resolveWidgetRequest } from "@/server/widget/resolve-widget-request";
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
