import { describe, expect, it, vi } from "vitest";
import { FareHarborPmsAdapter } from "./fareharbor-pms-adapter";

const CONFIG = {
  baseUrl: "https://fareharbor.example.test/api/external/v1",
  appKey: "app-1",
  userKey: "user-1",
  companyShortname: "reefco"
};

const AVAILABILITY = {
  availabilities: [
    {
      pk: "avail-9",
      start_at: "2026-07-20T09:00:00+10:00",
      capacity: 10,
      currency: "AUD",
      customer_type_rates: [
        { pk: "rate-adult", total_including_tax: 12500, customer_prototype: { display_name: "Adult" } },
        { pk: "rate-child", total_including_tax: 8000, customer_prototype: { display_name: "Child" } }
      ]
    }
  ]
};

describe("FareHarborPmsAdapter", () => {
  it("exposes provider identity and fails closed without credentials", async () => {
    const adapter = new FareHarborPmsAdapter();
    expect(adapter.provider).toBe("FAREHARBOR");
    await expect(adapter.listProducts()).rejects.toThrow(
      "FAREHARBOR PMS adapter requires baseUrl, appKey, userKey, and companyShortname before live calls."
    );
  });

  it("sends FareHarbor's two-header auth and maps items to Kai products", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({ items: [{ pk: "item-1", name: "Reef Snorkel", description: "Outer reef day trip" }] }),
        { status: 200 }
      )
    );
    const adapter = new FareHarborPmsAdapter({ ...CONFIG, fetcher });

    await expect(adapter.listProducts()).resolves.toEqual([
      { externalProductId: "item-1", title: "Reef Snorkel", description: "Outer reef day trip", bookingMode: "AUTO_BOOKING" }
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://fareharbor.example.test/api/external/v1/companies/reefco/items/",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ "X-FareHarbor-API-App": "app-1", "X-FareHarbor-API-User": "user-1" })
      })
    );
  });

  it("maps availability, picking the adult headline price and listing rate + time options", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(AVAILABILITY), { status: 200 }));
    const adapter = new FareHarborPmsAdapter({ ...CONFIG, fetcher });

    const result = await adapter.getAvailability({ productId: "item-1", date: "2026-07-20", guests: 2 });

    expect(result.available).toBe(true);
    expect(result.remaining).toBe(10);
    expect(result.currency).toBe("AUD");
    expect(result.unitPriceCents).toBe(12500); // adult, not child
    expect(result.ticketOptions).toEqual([
      { label: "Adult", unitPriceCents: 12500 },
      { label: "Child", unitPriceCents: 8000 }
    ]);
    expect(result.timeOptions?.[0]).toMatchObject({ startTimeLocal: "2026-07-20T09:00:00+10:00", remaining: 10, checkoutSessionId: "avail-9" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://fareharbor.example.test/api/external/v1/companies/reefco/items/item-1/availability/date/2026-07-20/",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("returns unavailable (no throw) when the date has no availabilities", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ availabilities: [] }), { status: 200 }));
    const adapter = new FareHarborPmsAdapter({ ...CONFIG, fetcher });

    const result = await adapter.getAvailability({ productId: "item-1", date: "2026-07-20", guests: 2 });
    expect(result.available).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("creates a booking against the resolved availability pk with one customer per guest", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ booking: { pk: "bk-777", status: "complete" } }), { status: 200 });
      }
      return new Response(JSON.stringify(AVAILABILITY), { status: 200 });
    });
    const adapter = new FareHarborPmsAdapter({ ...CONFIG, fetcher });

    const result = await adapter.createBooking({
      productId: "item-1",
      date: "2026-07-20",
      guests: 2,
      travellerName: "Sam Reef",
      travellerEmail: "sam@example.com"
    });

    expect(result).toEqual({ externalBookingId: "bk-777", provider: "FAREHARBOR", status: "CONFIRMED", paymentUrl: null });

    const postCall = fetcher.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(postCall?.[0]).toBe(
      "https://fareharbor.example.test/api/external/v1/companies/reefco/availabilities/avail-9/bookings/"
    );
    const body = JSON.parse(String((postCall?.[1] as RequestInit).body));
    expect(body.customers).toEqual([{ customer_type_rate: "rate-adult" }, { customer_type_rate: "rate-adult" }]);
    expect(body.contact).toMatchObject({ name: "Sam Reef", email: "sam@example.com" });
  });

  it("fails the booking (never invents one) when the slot lacks capacity", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ availabilities: [{ pk: "avail-1", start_at: "x", capacity: 1, customer_type_rates: [] }] }), { status: 200 })
    );
    const adapter = new FareHarborPmsAdapter({ ...CONFIG, fetcher });

    const result = await adapter.createBooking({
      productId: "item-1",
      date: "2026-07-20",
      guests: 4,
      travellerName: "Sam Reef",
      travellerEmail: "sam@example.com"
    });
    expect(result.status).toBe("FAILED");
    expect(result.externalBookingId).toBe("");
  });
});
