import type { PmsTimeOption } from "@/core/pms/types";

const BOATTIME_REZDY_SERVICE_IDS_BY_PRODUCT_CODE: Record<string, string> = {
  PGG8QT: "431872"
};

function findSelectedTimeOption(dateText: string | null | undefined, timeOptions: PmsTimeOption[] | null | undefined) {
  if (!dateText || !timeOptions?.length) return null;

  return timeOptions.find((option) => option.startTimeLocal === dateText) ?? null;
}

function resolveCheckoutOrigin(input: { tenantSlug: string; productUrl?: string | null }) {
  const configuredOrigin = process.env.REZDY_CHECKOUT_BASE_URL?.trim();
  if (configuredOrigin) return configuredOrigin.replace(/\/$/, "");

  if (input.productUrl) {
    try {
      const url = new URL(input.productUrl);
      if (url.hostname.endsWith(".rezdy.com")) {
        return url.origin;
      }
    } catch {
      return null;
    }
  }

  return input.tenantSlug === "boattime" ? "https://boattimeyachtcharters.rezdy.com" : null;
}

function resolveServiceId(input: { tenantSlug: string; productExternalId?: string | null; itemKey?: string | null }) {
  const itemKeyServiceId = input.itemKey?.match(/^item-(\d+)-/)?.[1];
  if (itemKeyServiceId) return itemKeyServiceId;

  if (!input.productExternalId) return null;

  const configuredMap = process.env.REZDY_SERVICE_ID_MAP?.trim();
  if (configuredMap) {
    try {
      const parsed = JSON.parse(configuredMap) as Record<string, string>;
      if (parsed[input.productExternalId]) return parsed[input.productExternalId];
    } catch {
      const entries = configuredMap.split(",").map((entry) => entry.trim().split(":"));
      const match = entries.find(([productCode]) => productCode === input.productExternalId);
      if (match?.[1]) return match[1].trim();
    }
  }

  return input.tenantSlug === "boattime"
    ? BOATTIME_REZDY_SERVICE_IDS_BY_PRODUCT_CODE[input.productExternalId] ?? null
    : null;
}

export function buildRezdyCheckoutUrl(input: {
  tenantSlug: string;
  productExternalId?: string | null;
  productUrl?: string | null;
  dateText?: string | null;
  timeOptions?: PmsTimeOption[] | null;
}) {
  const selectedTime = findSelectedTimeOption(input.dateText, input.timeOptions);
  const serviceId = resolveServiceId({
    tenantSlug: input.tenantSlug,
    productExternalId: input.productExternalId,
    itemKey: selectedTime?.checkoutItemKey
  });
  const itemKey =
    selectedTime?.checkoutItemKey ??
    (serviceId && selectedTime?.checkoutSessionId ? `item-${serviceId}-${selectedTime.checkoutSessionId}` : null);
  const origin = resolveCheckoutOrigin(input);

  if (!itemKey || !serviceId || !origin) {
    return null;
  }

  const url = new URL(`/services/${serviceId}`, origin);
  url.searchParams.set("itemKey", itemKey);
  url.searchParams.set("useTransparentSessions", "1");

  return url.toString();
}
