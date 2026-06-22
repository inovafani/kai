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
        description: "A shared day trip with auto-booking.",
        bookingMode: "AUTO_BOOKING"
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
        bookingMode: "AUTO_BOOKING"
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

  it("lists Boattime yacht charter products for the Boattime demo catalog", async () => {
    const adapter = new MockPmsAdapter("boattime");

    const products = await adapter.listProducts();

    expect(products.map((product) => product.title)).toEqual([
      "Gold Coast Whale Escape",
      "Private Yacht Charter",
      "Corporate Charter",
      "Wedding Yacht Charter",
      "Twilight Drift",
      "Coastal Lunch Escape",
      "Broadwater Twilight Dining"
    ]);
  });

  it("returns Boattime availability for instant ticketed products", async () => {
    const adapter = new MockPmsAdapter("boattime");

    const availability = await adapter.getAvailability({
      productId: "boattime-whale-escape",
      date: "tomorrow",
      guests: 4
    });

    expect(availability).toEqual({
      productId: "boattime-whale-escape",
      date: "tomorrow",
      available: true,
      remaining: 20,
      currency: "AUD",
      unitPriceCents: 9900
    });
  });
});
