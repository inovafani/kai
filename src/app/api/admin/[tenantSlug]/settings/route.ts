import type { PmsProvider } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { updateTenantOperationalSettings } from "@/server/tenant/tenant-repository";

export const runtime = "nodejs";

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

type TenantSettingsRouteProps = {
  params: Promise<{ tenantSlug: string }>;
};

export async function POST(request: NextRequest, { params }: TenantSettingsRouteProps) {
  const expectedToken = process.env.KAI_ADMIN_TOKEN;
  const adminToken = request.cookies.get("kai_admin_token")?.value;
  const { tenantSlug } = await params;

  if (!expectedToken || adminToken !== expectedToken) {
    return NextResponse.json(
      { error: { code: "ADMIN_TOKEN_REQUIRED", message: "Admin access is required." } },
      { status: 401 }
    );
  }

  const formData = await request.formData();
  const pmsProvider = String(formData.get("pmsProvider") ?? "") as PmsProvider;
  const allowedOrigins = parseList(formData.get("allowedOrigins"));
  const enabledFeatures = parseList(formData.get("enabledFeatures"));
  const responseGuardrails = parseList(formData.get("responseGuardrails"));

  if (!allowedProviders.has(pmsProvider)) {
    return NextResponse.json(
      { error: { code: "INVALID_PMS_PROVIDER", message: "Invalid PMS provider." } },
      { status: 400 }
    );
  }

  try {
    assertAllowedOrigins(allowedOrigins);
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_ALLOWED_ORIGINS",
          message: error instanceof Error ? error.message : "Invalid allowed origins."
        }
      },
      { status: 400 }
    );
  }

  await updateTenantOperationalSettings({
    tenantSlug,
    allowedOrigins,
    pmsProvider,
    enabledFeatures,
    responseGuardrails
  });

  return NextResponse.redirect(new URL("/admin/" + tenantSlug + "/settings?saved=1", request.url), 303);
}
