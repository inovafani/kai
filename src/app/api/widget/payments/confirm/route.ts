import { NextRequest, NextResponse } from "next/server";
import type { BookingFlowState } from "@/core/booking/booking-state-machine";
import { MappedPmsAdapter } from "@/core/pms/mapped-pms-adapter";
import type { PmsProvider } from "@/core/tenant/types";
import { findConversationBookingState, findTenantConversation, upsertConversationBookingState } from "@/server/conversation/conversation-repository";
import { parsePublicProductCatalog } from "@/core/pms/public-product-catalog";
import { getPmsAdapter } from "@/server/pms/pms-adapter-registry";
import { hasRezdyBookingWriteConfig } from "@/server/payments/rezdy-pay";
import { confirmRezdyPaymentBooking } from "@/server/payments/confirm-rezdy-payment";
import { getWidgetRequestOrigin } from "@/server/widget/request-origin";
import { resolveWidgetRequest } from "@/server/widget/resolve-widget-request";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    key?: string;
    conversationId?: string;
    cardToken?: string;
  } | null;

  if (!body?.key || !body.conversationId || !body.cardToken) {
    return NextResponse.json(
      {
        error: {
          code: "PAYMENT_CONFIRM_REQUIRED",
          message: "Missing widget key, conversation id, or secure card token."
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

  if (
    resolved.tenant.config?.pmsProvider !== "REZDY" ||
    !resolved.tenant.config.bookingWriteEnabled ||
    !hasRezdyBookingWriteConfig(process.env)
  ) {
    return NextResponse.json(
      {
        error: {
          code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
          message: "Secure RezdyPay confirmation is not connected for this tenant yet."
        }
      },
      { status: 501 }
    );
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

  if (!bookingState || bookingState.bookingStatus !== "PAYMENT_PENDING") {
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

  const provider = (resolved.tenant.config?.pmsProvider ?? "MOCK") as PmsProvider;
  const sourcePmsAdapter = getPmsAdapter(provider, process.env, fetch, resolved.tenant.slug);
  const publicProductCatalog = parsePublicProductCatalog(resolved.tenant.config?.publicProductCatalog);
  const pmsAdapter =
    publicProductCatalog.length > 0 ? new MappedPmsAdapter(sourcePmsAdapter, publicProductCatalog) : sourcePmsAdapter;

  try {
    const confirmation = await confirmRezdyPaymentBooking({
      pmsAdapter,
      state: bookingState as BookingFlowState,
      cardToken: body.cardToken
    });

    await upsertConversationBookingState({
      tenantId: resolved.tenant.id,
      conversationId: conversation.id,
      state: confirmation.state
    });

    if (confirmation.state.bookingStatus !== "CONFIRMED") {
      return NextResponse.json(
        {
          error: {
            code: "PAYMENT_BOOKING_FAILED",
            message: confirmation.state.bookingError ?? "Rezdy did not confirm this paid booking."
          }
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      status: "CONFIRMED",
      externalBookingId: confirmation.state.externalBookingId,
      provider: confirmation.state.externalProvider
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "PAYMENT_CONFIRM_FAILED",
          message: error instanceof Error ? error.message : "Rezdy payment confirmation failed."
        }
      },
      { status: 502 }
    );
  }
}
