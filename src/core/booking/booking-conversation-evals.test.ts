import { describe, expect, it } from "vitest";
import { updateBookingMemoryState, type BookingMemoryState } from "./booking-memory";
import { handleTravellerBookingMessage, type BookingOrchestratorResult } from "./booking-orchestrator";
import type { PmsAdapter, PmsAvailabilityRequest, PmsAvailabilityResult, PmsProduct } from "@/core/pms/types";

const boattimeProducts: PmsProduct[] = [
  {
    externalProductId: "boattime-whale-escape",
    title: "Gold Coast Whale Escape",
    description: "Luxury whale watching cruise",
    bookingMode: "AUTO_BOOKING",
    productUrl: "http://localhost:3107/demo/boattime#gold-coast-whale-escape"
  },
  {
    externalProductId: "boattime-twilight-drift",
    title: "Twilight Drift",
    description: "Sunset cruise experience",
    bookingMode: "AUTO_BOOKING",
    productUrl: "http://localhost:3107/demo/boattime#twilight-drift"
  },
  {
    externalProductId: "boattime-broadwater-twilight-dining",
    title: "Broadwater Twilight Dining",
    description: "Twilight dining cruise",
    bookingMode: "AUTO_BOOKING",
    productUrl: "http://localhost:3107/demo/boattime#broadwater-twilight-dining"
  },
  {
    externalProductId: "boattime-coastal-lunch-escape",
    title: "Coastal Lunch Escape",
    description: "Lunch cruise package",
    bookingMode: "AUTO_BOOKING",
    productUrl: "http://localhost:3107/demo/boattime#coastal-lunch-escape"
  },
  {
    externalProductId: "boattime-private-yacht-charter",
    title: "Private Yacht Charter",
    description: "Private yacht charter",
    bookingMode: "MANUAL_INQUIRY",
    productUrl: "http://localhost:3107/demo/boattime#private-yacht-charter"
  }
];

function boattimeAvailability(input: PmsAvailabilityRequest): PmsAvailabilityResult {
  if (input.productId === "boattime-whale-escape") {
    return {
      productId: input.productId,
      date: input.date,
      available: true,
      remaining: 78,
      currency: "AUD",
      unitPriceCents: 7900,
      timeOptions: [
        { label: "9:00 AM", startTimeLocal: `${input.date} 09:00:00`, remaining: 78 },
        { label: "12:00 PM", startTimeLocal: `${input.date} 12:00:00`, remaining: 75 },
        { label: "1:30 PM", startTimeLocal: `${input.date} 13:30:00`, remaining: 75 }
      ],
      ticketOptions: [
        { label: "Family (2A +2C) 3-13", unitPriceCents: 24900 },
        { label: '"2 people for $149.00', unitPriceCents: 14900 },
        { label: "Child (3-13)", unitPriceCents: 5900 },
        { label: "Infant (under 3)", unitPriceCents: 0 },
        { label: "Adult (Winter Special)", unitPriceCents: 7900 }
      ],
      extraOptions: [
        { label: "Corona Bucket", unitPriceCents: 3000 },
        { label: "Sparkling for 2", unitPriceCents: 4000 }
      ]
    };
  }

  if (input.productId === "boattime-twilight-drift") {
    return {
      productId: input.productId,
      date: input.date,
      available: true,
      remaining: 16,
      currency: "AUD",
      unitPriceCents: 7900,
      timeOptions: [{ label: "5:30 PM", startTimeLocal: `${input.date} 17:30:00`, remaining: 16 }],
      ticketOptions: [{ label: "Adult", unitPriceCents: 7900 }]
    };
  }

  return {
    productId: input.productId,
    date: input.date,
    available: true,
    remaining: 12,
    currency: "AUD",
    unitPriceCents: 9900
  };
}

function createBoattimeEvalAdapter(): PmsAdapter {
  return {
    provider: "MOCK",
    listProducts: async () => boattimeProducts,
    getAvailability: async (input) => boattimeAvailability(input),
    createBooking: async () => {
      throw new Error("Conversation evals should not create PMS bookings.");
    },
    cancelBooking: async () => ({ cancelled: false }),
    getBooking: async () => null
  };
}

async function runConversation(messages: string[]) {
  const pmsAdapter = createBoattimeEvalAdapter();
  let memory: BookingMemoryState | null = null;
  const priorTravellerMessages: string[] = [];
  const conversationHistory: Array<{ role: "traveller" | "assistant"; content: string }> = [];
  const turns: BookingOrchestratorResult[] = [];
  const products = await pmsAdapter.listProducts();

  for (const message of messages) {
    const bookingMemory = updateBookingMemoryState({
      previousState: memory,
      message,
      products
    });
    const result = await handleTravellerBookingMessage({
      message,
      priorTravellerMessages: [...priorTravellerMessages],
      conversationHistory: [...conversationHistory, { role: "traveller", content: message }],
      bookingMemory,
      pmsAdapter,
      bookingWriteEnabled: true
    });

    turns.push(result);
    memory = result.bookingStatePatch ?? bookingMemory;
    priorTravellerMessages.push(message);
    conversationHistory.push({ role: "traveller", content: message });
    conversationHistory.push({ role: "assistant", content: result.reply });
  }

  return { turns, memory };
}

describe("booking conversation evals", () => {
  it("keeps product-switch intent grounded in the latest traveller message", async () => {
    const { turns } = await runConversation([
      "can you give me recommendation?",
      "info on gold coast whale escape",
      "what about twilight drift?"
    ]);

    expect(turns[0]).toMatchObject({ action: "PRODUCT_RECOMMENDATION" });
    expect(turns[1]).toMatchObject({ action: "PRODUCT_LINK" });
    expect(turns[1].reply).toContain("Gold Coast Whale Escape");
    expect(turns[2]).toMatchObject({ action: "PRODUCT_LINK" });
    expect(turns[2].reply).toContain("Twilight Drift");
    expect(turns[2].reply).not.toContain("Gold Coast Whale Escape is");
  });

  it("lets the traveller switch products and continue availability in the same message", async () => {
    const { turns, memory } = await runConversation([
      "info on gold coast whale escape",
      "actually twilight drift for 2 people on 28 june"
    ]);

    expect(turns.map((turn) => turn.action)).toEqual(["PRODUCT_LINK", "AVAILABILITY_CHECKED"]);
    expect(turns[1].reply).toContain("Twilight Drift");
    expect(turns[1].reply).toContain("2 guests");
    expect(turns[1].reply).toContain("2026-06-28");
    expect(turns[1].reply).not.toContain("Gold Coast Whale Escape is available");
    expect(memory).toMatchObject({
      productTitle: "Twilight Drift",
      dateText: "2026-06-28",
      guests: 2
    });
  });

  it("moves a messy traveller from product browsing to secure payment without losing state", async () => {
    const { turns, memory } = await runConversation([
      "info on gold coast whale escape please",
      "28june, 3 people",
      "1:30 please",
      "option 5 x3",
      "no extras thanks",
      "David Samantha",
      "david@example.com 0412 345 678"
    ]);

    expect(turns.map((turn) => turn.action)).toEqual([
      "PRODUCT_LINK",
      "BOOKING_TIME_SELECTION_REQUIRED",
      "BOOKING_TICKET_SELECTION_REQUIRED",
      "BOOKING_EXTRAS_SELECTION_REQUIRED",
      "BOOKING_DETAILS_REQUIRED",
      "BOOKING_DETAILS_REQUIRED",
      "BOOKING_PAYMENT_REQUIRED"
    ]);
    expect(memory).toMatchObject({
      productTitle: "Gold Coast Whale Escape",
      dateText: "2026-06-28 13:30:00",
      guests: 3,
      travellerName: "David Samantha",
      travellerEmail: "david@example.com",
      travellerPhone: "0412 345 678",
      bookingStatus: "PAYMENT_PENDING"
    });
  });

  it("keeps manual-charter products out of instant booking", async () => {
    const { turns } = await runConversation(["i want private yacht charter for 20 people on 28 june"]);

    expect(turns[0]).toMatchObject({ action: "MANUAL_INQUIRY_REQUIRED" });
    expect(turns[0].reply).toContain("requires operator confirmation");
  });

  it("understands a numbered product choice after showing recommendations", async () => {
    const { turns } = await runConversation(["can you give me recommendation?", "1"]);

    expect(turns.map((turn) => turn.action)).toEqual(["PRODUCT_RECOMMENDATION", "PRODUCT_LINK"]);
    expect(turns[1].reply).toContain("Gold Coast Whale Escape");
    expect(turns[1].reply).not.toContain("You can choose from");
  });
});
