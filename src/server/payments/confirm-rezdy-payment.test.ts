import { describe, expect, it } from "vitest";
import { confirmRezdyPaymentBooking } from "./confirm-rezdy-payment";
import type { PmsAdapter } from "@/core/pms/types";
import type { BookingFlowState } from "@/core/booking/booking-state-machine";

const paymentPendingState: BookingFlowState = {
  productExternalId: "LWWE",
  productTitle: "Gold Coast Whale Escape",
  dateText: "2026-06-29 12:00:00",
  guests: 3,
  travellerName: "Inova Test",
  travellerEmail: "inoveka@gmail.com",
  travellerPhone: "086554328189",
  bookingStatus: "PAYMENT_PENDING",
  confirmationSummary: null,
  externalBookingId: null,
  externalProvider: null,
  bookingError: null,
  ticketQuantities: [
    { optionLabel: '"2 people for $149.00', quantity: 1 },
    { optionLabel: "Adult (Winter Special)", quantity: 1 }
  ],
  extraQuantities: [{ optionLabel: "Corona Bucket", quantity: 1 }]
};

describe("confirmRezdyPaymentBooking", () => {
  it("creates a paid Rezdy booking using a tokenized card", async () => {
    const createBookingCalls: unknown[] = [];
    const pmsAdapter: PmsAdapter = {
      provider: "REZDY",
      listProducts: async () => [],
      getAvailability: async () => {
        throw new Error("not needed");
      },
      createBooking: async (request) => {
        createBookingCalls.push(request);

        return {
          externalBookingId: "RZ-PAID",
          provider: "REZDY",
          status: "CONFIRMED"
        };
      },
      cancelBooking: async () => ({ cancelled: true }),
      getBooking: async () => null
    };

    const result = await confirmRezdyPaymentBooking({
      pmsAdapter,
      state: paymentPendingState,
      cardToken: "tok_rezdy_123"
    });

    expect(createBookingCalls).toEqual([
      expect.objectContaining({
        productId: "LWWE",
        date: "2026-06-29 12:00:00",
        guests: 3,
        travellerName: "Inova Test",
        travellerEmail: "inoveka@gmail.com",
        travellerPhone: "086554328189",
        ticketQuantities: paymentPendingState.ticketQuantities,
        extraQuantities: paymentPendingState.extraQuantities,
        paymentCardToken: "tok_rezdy_123",
        confirmationMode: "CONFIRM_NOW"
      })
    ]);
    expect(result.state).toMatchObject({
      bookingStatus: "CONFIRMED",
      externalBookingId: "RZ-PAID",
      externalProvider: "REZDY",
      bookingError: null
    });
  });

  it("rejects payment confirmation before the booking is payment-pending", async () => {
    await expect(
      confirmRezdyPaymentBooking({
        pmsAdapter: {
          provider: "REZDY",
          listProducts: async () => [],
          getAvailability: async () => {
            throw new Error("not needed");
          },
          createBooking: async () => {
            throw new Error("should not create");
          },
          cancelBooking: async () => ({ cancelled: true }),
          getBooking: async () => null
        },
        state: { ...paymentPendingState, bookingStatus: "READY_TO_CONFIRM" },
        cardToken: "tok_rezdy_123"
      })
    ).rejects.toThrow("Booking must be payment-pending");
  });
});
