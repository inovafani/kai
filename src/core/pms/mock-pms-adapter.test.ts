import { describe, expect, it } from "vitest";
import { MockPmsAdapter } from "./mock-pms-adapter";

describe("MockPmsAdapter", () => {
  it("lists deterministic instant-bookable products", async () => {
    const adapter = new MockPmsAdapter();

    const products = await adapter.listProducts();

    expect(products).toEqual([
      {
        externalProductId: "mock-komodo-day-trip",
        title: "Komodo Day Trip",
        description: "A shared day trip with instant booking.",
        bookingMode: "INSTANT_BOOKING"
      },
      {
        externalProductId: "mock-private-charter",
        title: "Private Charter",
        description: "A custom charter that requires operator confirmation.",
        bookingMode: "MANUAL_INQUIRY"
      },
      {
        externalProductId: "mock-reef-day-snorkel",
        title: "Reef Day Snorkel",
        description: "A guided snorkeling tour over bright reef sites.",
        bookingMode: "INSTANT_BOOKING"
      }
    ]);
  });

  it("returns availability for a known product", async () => {
    const adapter = new MockPmsAdapter();

    const availability = await adapter.getAvailability({
      productId: "mock-komodo-day-trip",
      date: "2026-10-12",
      guests: 2
    });

    expect(availability).toEqual({
      productId: "mock-komodo-day-trip",
      date: "2026-10-12",
      available: true,
      remaining: 8,
      currency: "USD",
      unitPriceCents: 18500
    });
  });

  it("creates a confirmed booking only when capacity is available", async () => {
    const adapter = new MockPmsAdapter();

    const booking = await adapter.createBooking({
      productId: "mock-komodo-day-trip",
      date: "2026-10-12",
      guests: 2,
      travellerName: "Ari Test",
      travellerEmail: "ari@example.com"
    });

    expect(booking).toEqual({
      externalBookingId: "mock-booking-mock-komodo-day-trip-2026-10-12-2",
      provider: "MOCK",
      status: "CONFIRMED"
    });
  });
});
