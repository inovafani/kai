import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAffiliateTripsCache, fetchAffiliateTrips } from "./affiliate-trips-client";

const trip = {
  slug: "outer-reef-day",
  title: "Outer Reef Day",
  operatorName: "Reef Magic",
  region: "Great Barrier Reef",
  category: "Dive",
  description: "A day on the reef.",
  priceSignal: "From AUD 249",
  bookingPlatform: "FAREHARBOR",
  bookingUrl: "https://fareharbor.com/embeds/book/reefmagic/"
};
const env = { BLUEPASS_APP_URL: "https://bluepass.example/" };

afterEach(() => clearAffiliateTripsCache());

describe("fetchAffiliateTrips", () => {
  it("reads the BluePass app's live trips and caches them for five minutes", async () => {
    const fetcher = vi.fn(async () => Response.json({ trips: [trip, { ...trip, slug: "bad", bookingUrl: "https://example.com" }] }));
    const first = await fetchAffiliateTrips(env, fetcher as unknown as typeof fetch, 0);
    expect(first.map((item) => item.slug)).toEqual(["outer-reef-day"]);
    expect(fetcher).toHaveBeenCalledWith("https://bluepass.example/api/kai/affiliate-trips", expect.anything());

    await fetchAffiliateTrips(env, fetcher as unknown as typeof fetch, 4 * 60 * 1000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await fetchAffiliateTrips(env, fetcher as unknown as typeof fetch, 6 * 60 * 1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("never throws: no app URL, an error or a bad response all mean no trips this turn", async () => {
    expect(await fetchAffiliateTrips({}, vi.fn() as unknown as typeof fetch, 0)).toEqual([]);
    const failing = vi.fn(async () => {
      throw new Error("down");
    });
    expect(await fetchAffiliateTrips(env, failing as unknown as typeof fetch, 0)).toEqual([]);
    const notOk = vi.fn(async () => new Response("nope", { status: 500 }));
    expect(await fetchAffiliateTrips(env, notOk as unknown as typeof fetch, 0)).toEqual([]);
  });

  it("keeps the last good list when the app briefly fails", async () => {
    const ok = vi.fn(async () => Response.json({ trips: [trip] }));
    await fetchAffiliateTrips(env, ok as unknown as typeof fetch, 0);
    const failing = vi.fn(async () => new Response("nope", { status: 502 }));
    const later = await fetchAffiliateTrips(env, failing as unknown as typeof fetch, 10 * 60 * 1000);
    expect(later.map((item) => item.slug)).toEqual(["outer-reef-day"]);
  });
});
