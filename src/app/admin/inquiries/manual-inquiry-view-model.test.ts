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
});
