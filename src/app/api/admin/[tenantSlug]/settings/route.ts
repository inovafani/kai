import type { PmsProvider } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { parsePublicProductCatalogRows } from "@/core/pms/public-product-catalog";
import { updateTenantOperationalSettings } from "@/server/tenant/tenant-repository";

export const runtime = "nodejs";

const allowedProviders = new Set<PmsProvider>(["MOCK", "REZDY", "INSEANQ", "FAREHARBOR", "BOKUN", "NATIVE"]);

function parseList(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOriginList(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split(/\r?\n|,|(?=https?:\/\/)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeAllowedOrigins(origins: string[]) {
  if (origins.length === 0) {
    throw new Error("At least one allowed origin is required.");
  }

  const normalized = origins.map((origin) => {
    const cleanedOrigin = origin.replace(/https?$/i, "");
    const url = new URL(cleanedOrigin);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Allowed origins must use http or https.");
    }

    return url.origin;
  });

  return Array.from(new Set(normalized));
}

type TenantSettingsRouteProps = {
  params: Promise<{ tenantSlug: string }>;
};

export async function POST(request: NextRequest, { params }: TenantSettingsRouteProps) {
  const expectedToken = process.env.KAI_ADMIN_TOKEN;
  const cookieAdminToken = request.cookies.get("kai_admin_token")?.value;
  const { tenantSlug } = await params;
  const formData = await request.formData();
  const formAdminToken = String(formData.get("adminToken") ?? "");

  if (!expectedToken || (cookieAdminToken !== expectedToken && formAdminToken !== expectedToken)) {
    return NextResponse.json(
      { error: { code: "ADMIN_TOKEN_REQUIRED", message: "Admin access is required." } },
      { status: 401 }
    );
  }
  const pmsProvider = String(formData.get("pmsProvider") ?? "") as PmsProvider;
  const allowedOrigins = parseOriginList(formData.get("allowedOrigins"));
  const enabledFeatures = parseList(formData.get("enabledFeatures"));
  const responseGuardrails = parseList(formData.get("responseGuardrails"));
  const brandVoice = String(formData.get("brandVoice") ?? "").trim();
  const bookingWriteEnabled = formData.get("bookingWriteEnabled") === "on";
  let publicProductCatalog: ReturnType<typeof parsePublicProductCatalogRows>;

  if (!allowedProviders.has(pmsProvider)) {
    return NextResponse.json(
      { error: { code: "INVALID_PMS_PROVIDER", message: "Invalid PMS provider." } },
      { status: 400 }
    );
  }

  try {
    const normalizedAllowedOrigins = normalizeAllowedOrigins(allowedOrigins);
    allowedOrigins.splice(0, allowedOrigins.length, ...normalizedAllowedOrigins);
    publicProductCatalog = parsePublicProductCatalogRows({
      publicTitles: formData.getAll("productPublicTitle").map(String),
      publicDescriptions: formData.getAll("productPublicDescription").map(String),
      productUrls: formData.getAll("productUrl").map(String),
      pmsProductIds: formData.getAll("productPmsProductId").map(String),
      bookingModes: formData.getAll("productBookingMode").map(String)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_SETTINGS",
          message: error instanceof Error ? error.message : "Invalid settings."
        }
      },
      { status: 400 }
    );
  }

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

  return NextResponse.redirect(new URL("/admin/" + tenantSlug + "/settings?saved=1", request.url), 303);
}
