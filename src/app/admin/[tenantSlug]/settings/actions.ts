"use server";

import type { PmsProvider } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parsePublicProductCatalogRows } from "@/core/pms/public-product-catalog";
import { updateTenantOperationalSettings } from "@/server/tenant/tenant-repository";

const allowedProviders = new Set<PmsProvider>(["MOCK", "REZDY", "INSEANQ", "FAREHARBOR", "BOKUN", "NATIVE"]);

function parseList(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function assertAllowedOrigins(origins: string[]) {
  if (origins.length === 0) {
    throw new Error("At least one allowed origin is required.");
  }

  for (const origin of origins) {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Allowed origins must use http or https.");
    }
    if (url.pathname !== "/" || url.search || url.hash) {
      throw new Error("Allowed origins must not include paths, query strings, or hashes.");
    }
  }
}

export async function updateTenantOperationalSettingsAction(formData: FormData) {
  const tenantSlug = String(formData.get("tenantSlug") ?? "");
  const pmsProvider = String(formData.get("pmsProvider") ?? "") as PmsProvider;
  const allowedOrigins = parseList(formData.get("allowedOrigins"));
  const enabledFeatures = parseList(formData.get("enabledFeatures"));
  const responseGuardrails = parseList(formData.get("responseGuardrails"));
  const brandVoice = String(formData.get("brandVoice") ?? "").trim();
  const bookingWriteEnabled = formData.get("bookingWriteEnabled") === "on";
  const publicProductCatalog = parsePublicProductCatalogRows({
    publicTitles: formData.getAll("productPublicTitle").map(String),
    publicDescriptions: formData.getAll("productPublicDescription").map(String),
    productUrls: formData.getAll("productUrl").map(String),
    pmsProductIds: formData.getAll("productPmsProductId").map(String),
    bookingModes: formData.getAll("productBookingMode").map(String)
  });

  if (!tenantSlug || !allowedProviders.has(pmsProvider)) {
    throw new Error("Invalid tenant settings update.");
  }

  assertAllowedOrigins(allowedOrigins);

  await updateTenantOperationalSettings({
    tenantSlug,
    allowedOrigins,
    pmsProvider,
    publicProductCatalog,
    bookingWriteEnabled,
    enabledFeatures,
    responseGuardrails,
    brandVoice
  });

  revalidatePath("/admin/" + tenantSlug + "/settings");
  revalidatePath("/api/widget/config");
  redirect("/admin/" + tenantSlug + "/settings?saved=1");
}
