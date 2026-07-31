import { FareHarborPmsAdapter } from "@/core/pms/fareharbor-pms-adapter";
import { InseanqPmsAdapter } from "@/core/pms/inseanq-pms-adapter";
import { MockPmsAdapter, type MockPmsCatalog } from "@/core/pms/mock-pms-adapter";
import { RezdyPmsAdapter } from "@/core/pms/rezdy-pms-adapter";
import type { PmsAdapter } from "@/core/pms/types";
import type { PmsProvider } from "@/core/tenant/types";

type Fetcher = typeof fetch;
type PmsAdapterEnvironment = Record<string, string | undefined>;

function readTimeout(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function getPmsAdapter(
  provider: PmsProvider,
  env: PmsAdapterEnvironment = process.env,
  fetcher: Fetcher = fetch,
  tenantSlug?: string
): PmsAdapter {
  if (provider === "MOCK") {
    // Australia is the launch market, so the default mock catalog is AU; boattime keeps
    // its Gold Coast catalog, and only an explicitly Indonesian tenant gets komodo.
    const catalog: MockPmsCatalog =
      tenantSlug === "boattime"
        ? "boattime"
        : /komodo|indonesia|raja|labuan|flores/i.test(tenantSlug ?? "")
          ? "komodo"
          : "australia";
    return new MockPmsAdapter(catalog);
  }

  if (provider === "REZDY") {
    return new RezdyPmsAdapter({
      baseUrl: env.REZDY_BASE_URL,
      apiKey: env.REZDY_API_KEY,
      apiKeyPlacement: "query",
      productListPath: env.REZDY_PRODUCT_LIST_PATH,
      availabilityPath: env.REZDY_AVAILABILITY_PATH,
      bookingPath: env.REZDY_BOOKING_PATH,
      timeoutMs: readTimeout(env.REZDY_TIMEOUT_MS),
      fetcher
    });
  }

  if (provider === "FAREHARBOR") {
    return new FareHarborPmsAdapter({
      baseUrl: env.FAREHARBOR_BASE_URL,
      appKey: env.FAREHARBOR_APP_KEY,
      userKey: env.FAREHARBOR_USER_KEY,
      companyShortname: env.FAREHARBOR_COMPANY_SHORTNAME,
      timeoutMs: readTimeout(env.FAREHARBOR_TIMEOUT_MS),
      fetcher
    });
  }

  if (provider === "INSEANQ") {
    return new InseanqPmsAdapter({
      baseUrl: env.INSEANQ_BASE_URL,
      apiKey: env.INSEANQ_API_KEY,
      productListPath: env.INSEANQ_PRODUCT_LIST_PATH,
      availabilityPath: env.INSEANQ_AVAILABILITY_PATH,
      timeoutMs: readTimeout(env.INSEANQ_TIMEOUT_MS),
      fetcher
    });
  }

  throw new Error(`PMS provider ${provider} is configured but no adapter shell exists yet.`);
}
