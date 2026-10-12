import { parseAffiliateTrips, type AffiliateTrip } from "@/core/affiliate/affiliate-trips";

const CACHE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 2500;

let cached: { at: number; trips: AffiliateTrip[] } | null = null;

/**
 * The live trips BluePass resells, from the BluePass app's public /api/kai/affiliate-trips (the
 * admin "Affiliate trips" page is the one place they are kept). Cached for five minutes, the same
 * as the app's own cache of that route. Never throws: if the app is unreachable Kai simply has no
 * resold trips to offer this turn and carries on with its usual conversation.
 */
export async function fetchAffiliateTrips(
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
  now: number = Date.now()
): Promise<AffiliateTrip[]> {
  if (cached && now - cached.at < CACHE_MS) return cached.trips;

  const baseUrl = (env.BLUEPASS_APP_URL ?? env.NEXT_PUBLIC_BLUEPASS_APP_URL)?.trim().replace(/\/+$/, "");
  if (!baseUrl) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(`${baseUrl}/api/kai/affiliate-trips`, { signal: controller.signal });
    if (!response.ok) return cached?.trips ?? [];
    const payload = (await response.json()) as { trips?: unknown };
    const trips = parseAffiliateTrips(payload.trips);
    cached = { at: now, trips };
    return trips;
  } catch (error) {
    console.warn("affiliate_trips.fetch_failed", { message: error instanceof Error ? error.message : String(error) });
    return cached?.trips ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

/** Tests only. */
export function clearAffiliateTripsCache() {
  cached = null;
}
