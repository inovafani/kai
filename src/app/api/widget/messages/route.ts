import { NextRequest, NextResponse } from "next/server";
import { updateBookingMemoryState } from "@/core/booking/booking-memory";
import { handleTravellerBookingMessage } from "@/core/booking/booking-orchestrator";
import type { PmsProvider } from "@/core/tenant/types";
import {
  createAssistantMessage,
  createManualInquiry,
  createTravellerMessage,
  findConversationBookingState,
  findTenantConversation,
  upsertConversationBookingState
} from "@/server/conversation/conversation-repository";
import { createOpenAiAssistantClient } from "@/server/llm/openai-assistant-client";
import { getPmsAdapter } from "@/server/pms/pms-adapter-registry";
import { getWidgetRequestOrigin } from "@/server/widget/request-origin";
import { resolveWidgetRequest } from "@/server/widget/resolve-widget-request";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    key?: string;
    conversationId?: string;
    content?: string;
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

  const previousBookingState = await findConversationBookingState({
    tenantId: resolved.tenant.id,
    conversationId: conversation.id
  });

  const message = await createTravellerMessage({
    tenantId: resolved.tenant.id,
    conversationId: conversation.id,
    content
  });

  const provider = (resolved.tenant.config?.pmsProvider ?? "MOCK") as PmsProvider;
  const llmClient = createOpenAiAssistantClient(process.env);
  let assistantContent: string;
  let manualInquiry: Awaited<ReturnType<typeof createManualInquiry>> | null = null;

  try {
    const pmsAdapter = getPmsAdapter(provider);
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
      bookingMemory: bookingState,
      pmsAdapter,
      llmClient
    });

    if (bookingResult.action === "MANUAL_INQUIRY_REQUIRED") {
      manualInquiry = await createManualInquiry({
        tenantId: resolved.tenant.id,
        conversationId: conversation.id,
        state: bookingState,
        travellerMessage: content
      });
    }

    assistantContent = bookingResult.reply;
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
          guests: manualInquiry.guests
        }
      : null
  });
}
