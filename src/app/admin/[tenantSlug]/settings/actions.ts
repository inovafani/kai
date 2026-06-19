"use server";

import type { PmsProvider } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

  if (!tenantSlug || !allowedProviders.has(pmsProvider)) {
    throw new Error("Invalid tenant settings update.");
  }

  assertAllowedOrigins(allowedOrigins);

  await updateTenantOperationalSettings({
    tenantSlug,
    allowedOrigins,
    pmsProvider,
    enabledFeatures,
    responseGuardrails
  });

  revalidatePath("/admin/" + tenantSlug + "/settings");
  revalidatePath("/api/widget/config");
  redirect("/admin/" + tenantSlug + "/settings?saved=1");
}
