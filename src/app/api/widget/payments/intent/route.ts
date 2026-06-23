import { NextRequest, NextResponse } from "next/server";
import { findConversationBookingState, findTenantConversation } from "@/server/conversation/conversation-repository";
import { hasRezdyBookingWriteConfig, resolveRezdyStripePublishableKey } from "@/server/payments/rezdy-pay";
import { getWidgetRequestOrigin } from "@/server/widget/request-origin";
import { resolveWidgetRequest } from "@/server/widget/resolve-widget-request";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    key?: string;
    conversationId?: string;
  } | null;

  if (!body?.key || !body.conversationId) {
    return NextResponse.json(
      {
        error: {
          code: "PAYMENT_REQUEST_REQUIRED",
          message: "Missing widget key or conversation id."
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

  const bookingState = await findConversationBookingState({
    tenantId: resolved.tenant.id,
    conversationId: conversation.id
  });

  if (bookingState?.bookingStatus !== "PAYMENT_PENDING") {
    return NextResponse.json(
      {
        error: {
          code: "PAYMENT_NOT_READY",
          message: "This conversation does not have a booking ready for secure payment."
        }
      },
      { status: 409 }
    );
  }

  if (
    resolved.tenant.config?.pmsProvider !== "REZDY" ||
    !resolved.tenant.config.bookingWriteEnabled ||
    !hasRezdyBookingWriteConfig(process.env)
  ) {
    return NextResponse.json(
      {
        error: {
          code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
          message: "Secure payment is not connected for this tenant yet."
        }
      },
      { status: 501 }
    );
  }

  return NextResponse.json({
    provider: "REZDYPAY_STRIPE",
    publishableKey: resolveRezdyStripePublishableKey(process.env),
    conversationId: conversation.id
  });
}
