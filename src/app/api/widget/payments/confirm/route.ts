import { NextRequest, NextResponse } from "next/server";
import {
  beginPaidExternalBooking,
  markExternalBookingConfirmed,
  markExternalBookingFailed,
  type BookingFlowState
} from "@/core/booking/booking-state-machine";
import type { BookingMemoryState } from "@/core/booking/booking-memory";
import { MappedPmsAdapter } from "@/core/pms/mapped-pms-adapter";
import { parsePublicProductCatalog } from "@/core/pms/public-product-catalog";
import type { PmsProvider } from "@/core/tenant/types";
import {
  createAssistantMessage,
  findConversationBookingState,
  findTenantConversation,
  upsertConversationBookingState
} from "@/server/conversation/conversation-repository";
import { hasRezdyBookingWriteConfig } from "@/server/payments/rezdy-pay";
import { getPmsAdapter } from "@/server/pms/pms-adapter-registry";
import { getWidgetRequestOrigin } from "@/server/widget/request-origin";
import { resolveWidgetRequest } from "@/server/widget/resolve-widget-request";

export const runtime = "nodejs";

type PaidBookingState = BookingFlowState &
  BookingMemoryState & {
    productExternalId: string;
    productTitle: string;
    dateText: string;
    guests: number;
    travellerName: string;
    travellerEmail: string;
  };

function isReadyForPaidBooking(state: Awaited<ReturnType<typeof findConversationBookingState>>): state is PaidBookingState {
  return Boolean(
    state?.bookingStatus === "PAYMENT_PENDING" &&
      state.productExternalId &&
      state.productTitle &&
      state.dateText &&
      state.guests &&
      state.travellerName &&
      state.travellerEmail
  );
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    key?: string;
    conversationId?: string;
    cardToken?: string;
  } | null;

  if (!body?.key || !body.conversationId || !body.cardToken?.trim()) {
    return NextResponse.json(
      {
        error: {
          code: "PAYMENT_CONFIRMATION_REQUIRED",
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

  const bookingState = await findConversationBookingState({
    tenantId: resolved.tenant.id,
    conversationId: conversation.id
  });

  if (!isReadyForPaidBooking(bookingState)) {
    return NextResponse.json(
      {
        error: {
          code: "PAYMENT_NOT_READY",
          message: "This conversation does not have complete booking details ready for payment."
        }
      },
      { status: 409 }
    );
  }

  const pendingState = beginPaidExternalBooking(bookingState);
  await upsertConversationBookingState({
    tenantId: resolved.tenant.id,
    conversationId: conversation.id,
    state: pendingState
  });

  try {
    const provider = (resolved.tenant.config.pmsProvider ?? "REZDY") as PmsProvider;
    const sourcePmsAdapter = getPmsAdapter(provider, process.env, fetch, resolved.tenant.slug);
    const publicProductCatalog = parsePublicProductCatalog(resolved.tenant.config.publicProductCatalog);
    const pmsAdapter =
      publicProductCatalog.length > 0 ? new MappedPmsAdapter(sourcePmsAdapter, publicProductCatalog) : sourcePmsAdapter;
    const booking = await pmsAdapter.createBooking({
      productId: bookingState.productExternalId,
      date: bookingState.dateText,
      guests: bookingState.guests,
      travellerName: bookingState.travellerName,
      travellerEmail: bookingState.travellerEmail,
      travellerPhone: bookingState.travellerPhone,
      ticketQuantities: bookingState.ticketQuantities,
      extraQuantities: bookingState.extraQuantities,
      paymentCardToken: body.cardToken.trim()
    });

    if (booking.status !== "CONFIRMED" || !booking.externalBookingId) {
      throw new Error("Rezdy did not return a confirmed booking.");
    }

    const confirmedState = markExternalBookingConfirmed(pendingState, {
      externalBookingId: booking.externalBookingId,
      externalProvider: booking.provider
    });
    await upsertConversationBookingState({
      tenantId: resolved.tenant.id,
      conversationId: conversation.id,
      state: confirmedState
    });

    const assistantMessage = await createAssistantMessage({
      tenantId: resolved.tenant.id,
      conversationId: conversation.id,
      content: `Payment received and your booking is confirmed. Confirmation reference: ${booking.externalBookingId}.`
    });

    return NextResponse.json({
      booking,
      assistantMessage: {
        id: assistantMessage.id,
        tenantSlug: resolved.tenant.slug,
        conversationId: assistantMessage.conversationId,
        role: assistantMessage.role,
        content: assistantMessage.content
      }
    });
  } catch (error) {
    const failedState = markExternalBookingFailed(
      pendingState,
      error instanceof Error ? error.message : "Rezdy booking failed after payment tokenization."
    );
    await upsertConversationBookingState({
      tenantId: resolved.tenant.id,
      conversationId: conversation.id,
      state: failedState
    });

    return NextResponse.json(
      {
        error: {
          code: "REZDY_BOOKING_FAILED",
          message:
            "Secure payment could not complete the Rezdy booking. The operator has the lead details and should review it."
        }
      },
      { status: 502 }
    );
  }
}
