import { NextRequest, NextResponse } from "next/server";
import { updateBookingMemoryState } from "@/core/booking/booking-memory";
import { handleTravellerBookingMessage } from "@/core/booking/booking-orchestrator";
import { MappedPmsAdapter } from "@/core/pms/mapped-pms-adapter";
import { parsePublicProductCatalog } from "@/core/pms/public-product-catalog";
import type { PmsProvider } from "@/core/tenant/types";
import {
  createAssistantMessage,
  createManualInquiry,
  createTravellerMessage,
  findConversationBookingState,
  findTenantConversation,
  listRecentConversationMessages,
  listRecentTravellerMessageContents,
  upsertConversationBookingState
} from "@/server/conversation/conversation-repository";
import { createAssistantLlmClient } from "@/server/llm/assistant-llm-client";
import { createGenericBookingRouterClient } from "@/server/llm/generic-booking-router-client";
import { createBluePassRouterClient } from "@/server/llm/bluepass-router-client";
import { buildBookingFailureManualInquiry } from "@/server/conversation/manual-inquiry-fallback";
import { handleBluePassMarketplaceMessage } from "@/server/bluepass/bluepass-message-flow";
import { composeBluePassMarketplaceAssistantReply } from "@/server/bluepass/bluepass-marketplace-reply-composer";
import { shouldPolishBluePassMarketplaceReply } from "@/server/bluepass/bluepass-marketplace-reply-gate";
import type { BluePassCatalogSnapshotItem } from "@/core/bluepass/catalog";
import { resolveTenantBusinessPack } from "@/server/business-pack/resolve-tenant-business-pack";
import { getPmsAdapter } from "@/server/pms/pms-adapter-registry";
import { resolveTenantPmsEnv } from "@/server/pms/tenant-pms-credentials";
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
      marketplaceResult: bluepassResult
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

  const provider = (resolved.tenant.config?.pmsProvider ?? "MOCK") as PmsProvider;
  const llmClient = createAssistantLlmClient(process.env);
  const routerClient = createGenericBookingRouterClient(process.env);
  let assistantContent: string;
  let manualInquiry: Awaited<ReturnType<typeof createManualInquiry>> | null = null;
  let paymentRequest:
    | {
        conversationId: string;
        productTitle: string | null;
        dateText: string | null;
        guests: number | null;
        checkoutUrl: string | null;
        status: "PAYMENT_PENDING";
      }
    | null = null;
  let contactRequest:
    | {
        conversationId: string;
        fields: ["name", "email", "phone"];
        status: "CONTACT_DETAILS_REQUIRED";
      }
    | null = null;

  try {
    const tenantPmsEnv = await resolveTenantPmsEnv(resolved.tenant.id, provider, process.env);
    const sourcePmsAdapter = getPmsAdapter(provider, tenantPmsEnv, fetch, resolved.tenant.slug);
    const publicProductCatalog = parsePublicProductCatalog(resolved.tenant.config?.publicProductCatalog);
    const pmsAdapter =
      publicProductCatalog.length > 0 ? new MappedPmsAdapter(sourcePmsAdapter, publicProductCatalog) : sourcePmsAdapter;
    const products = await pmsAdapter.listProducts();
    const bookingState = updateBookingMemoryState({
      previousState: previousBookingState,
      message: content,
      products
    });

    await upsertConversationBookingState({
      tenantId: resolved.tenant.id,
      conversationId: conversation.id,
      state: bookingState
    });

    const bookingResult = await handleTravellerBookingMessage({
      message: content,
      priorTravellerMessages,
      conversationHistory: [...priorConversationMessages, { role: "traveller", content }],
      bookingMemory: bookingState,
      pmsAdapter,
      bookingWriteEnabled: resolved.tenant.config?.bookingWriteEnabled ?? false,
      allowUnpaidExternalBooking: false,
      llmClient,
      routerClient,
      tenantContext: {
        tenantName: resolved.tenant.name,
        brandVoice: resolved.tenant.branding?.brandVoice ?? null,
        pmsProvider: provider,
        responseGuardrails: resolved.tenant.config?.responseGuardrails ?? [],
        productTitles: products.map((product) => product.title)
      }
    });

    if (bookingResult.action === "MANUAL_INQUIRY_REQUIRED") {
      manualInquiry = await createManualInquiry({
        tenantId: resolved.tenant.id,
        conversationId: conversation.id,
        state: bookingState,
        travellerMessage: content
      });
    }

    const bookingStatePatch = bookingResult.bookingStatePatch;

    if (bookingStatePatch) {
      await upsertConversationBookingState({
        tenantId: resolved.tenant.id,
        conversationId: conversation.id,
        state: bookingStatePatch
      });

      if (bookingResult.action === "BOOKING_PAYMENT_REQUIRED") {
        paymentRequest = {
          conversationId: conversation.id,
          productTitle: bookingStatePatch.productTitle,
          dateText: bookingStatePatch.dateText,
          guests: bookingStatePatch.guests,
          checkoutUrl: null,
          status: "PAYMENT_PENDING"
        };
      }
    }

    const bookingFailureInquiry = buildBookingFailureManualInquiry(bookingResult);
    if (bookingFailureInquiry) {
      manualInquiry = await createManualInquiry({
        tenantId: resolved.tenant.id,
        conversationId: conversation.id,
        state: bookingFailureInquiry.state,
        travellerMessage: content,
        travellerName: bookingFailureInquiry.travellerName,
        travellerEmail: bookingFailureInquiry.travellerEmail,
        travellerPhone: bookingFailureInquiry.travellerPhone
      });
    }

    if (
      (bookingResult.action === "BOOKING_INQUIRY_READY" ||
        bookingResult.action === "BOOKING_WRITE_DISABLED" ||
        bookingResult.action === "BOOKING_CHECKOUT_READY" ||
        bookingResult.action === "BOOKING_PAYMENT_REQUIRED") &&
      bookingResult.inquiryDraft
    ) {
      manualInquiry = await createManualInquiry({
        tenantId: resolved.tenant.id,
        conversationId: conversation.id,
        state: {
          productExternalId: bookingResult.inquiryDraft.productExternalId,
          productTitle: bookingResult.inquiryDraft.productTitle,
          dateText: bookingResult.inquiryDraft.dateText,
          guests: bookingResult.inquiryDraft.guests
        },
        travellerMessage: content,
        travellerName: bookingResult.inquiryDraft.travellerName,
        travellerEmail: bookingResult.inquiryDraft.travellerEmail,
        travellerPhone: bookingResult.inquiryDraft.travellerPhone
      });
    }

    assistantContent = bookingResult.reply;
    const asksForContactDetails =
      bookingResult.action === "BOOKING_DETAILS_REQUIRED" &&
      /name,\s*email,\s*and\s*phone/i.test(bookingResult.reply);

    if (asksForContactDetails) {
      contactRequest = {
        conversationId: conversation.id,
        fields: ["name", "email", "phone"],
        status: "CONTACT_DETAILS_REQUIRED"
      };
    }
  } catch (error) {
    assistantContent =
      error instanceof Error
        ? "I can help with this, but " + error.message
        : "I can help with this, but the PMS adapter is not available right now.";
  }

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
