import { describe, expect, it } from "vitest";
import { toManualInquiryViewModel } from "./manual-inquiry-view-model";

describe("manual inquiry view model", () => {
  it("summarizes failed PMS booking fallback for operator review", () => {
    const viewModel = toManualInquiryViewModel({
      id: "inquiry-1",
      conversationId: "conversation-1",
      status: "OPEN",
      productTitle: "Gold Coast Whale Escape",
      dateText: "tomorrow",
      guests: 3,
      travellerName: "Kala",
      travellerEmail: "kala@gmail.com",
      travellerPhone: "086554329278",
      travellerMessage: "Gold Coast Whale Escape on tomorrow for 3 guests under Kala.",
      createdAt: new Date("2026-06-22T08:44:00.000Z"),
      tenant: { name: "Boattime Yacht Charters" },
      conversation: {
        bookingState: {
          bookingStatus: "FAILED",
          confirmationSummary: "Gold Coast Whale Escape on tomorrow for 3 guests under Kala.",
          bookingError: "PMS booking request failed."
        }
      }
    });

    expect(viewModel).toMatchObject({
      productTitle: "Gold Coast Whale Escape",
      bookingStatus: "FAILED",
      operatorReason: "PMS booking failed",
      operatorNextStep: "Auto-booking failed. Retry PMS booking or create it manually, then notify the traveller.",
      bookingError: "PMS booking request failed.",
      customerLine: "Kala · kala@gmail.com · 086554329278",
      requestLine: "tomorrow · 3 guests · Boattime Yacht Charters"
    });
  });

  it("uses a clear next step for normal manual inquiries", () => {
    const viewModel = toManualInquiryViewModel({
      id: "inquiry-2",
      conversationId: "conversation-2",
      status: "OPEN",
      productTitle: "Private Yacht Charter",
      dateText: "tomorrow",
      guests: 2,
      travellerName: null,
      travellerEmail: null,
      travellerPhone: null,
      travellerMessage: "private yacht for 2 guests tomorrow",
      createdAt: new Date("2026-06-22T08:47:00.000Z"),
      tenant: { name: "Kai Demo" },
      conversation: { bookingState: null }
    });

    expect(viewModel).toMatchObject({
      bookingStatus: null,
      operatorReason: "Manual review required",
      operatorNextStep: "Review the conversation, contact the traveller if needed, then mark the inquiry notified or closed.",
      customerLine: null,
      requestLine: "tomorrow · 2 guests · Kai Demo"
    });
  });

  it("surfaces pending Rezdy cart references for operator payment follow-up", () => {
    const viewModel = toManualInquiryViewModel({
      id: "inquiry-3",
      conversationId: "conversation-3",
      status: "OPEN",
      productTitle: "Gold Coast Whale Escape",
      dateText: "2026-06-29 13:30:00",
      guests: 3,
      travellerName: "Inov Test",
      travellerEmail: "inoveka@gmail.com",
      travellerPhone: "087665321876",
      travellerMessage: "My name is Inov Test, email is inoveka@gmail.com, phone number is 087665321876",
      createdAt: new Date("2026-06-24T15:18:47.000Z"),
      tenant: { name: "Boattime Yacht Charters" },
      conversation: {
        bookingState: {
          bookingStatus: "PAYMENT_PENDING",
          confirmationSummary: null,
          bookingError: null,
          externalBookingId: "RYGUNQF",
          externalProvider: "REZDY"
        }
      }
    });

    expect(viewModel).toMatchObject({
      bookingStatus: "PAYMENT_PENDING",
      externalBookingId: "RYGUNQF",
      externalProvider: "REZDY",
      operatorReason: "Payment follow-up required",
      operatorNextStep: "Search Rezdy order RYGUNQF, then send the secure payment link or follow up with the traveller."
    });
  });
});
