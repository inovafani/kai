import { NextRequest, NextResponse } from "next/server";
import { resolveWidgetTenant } from "@/core/tenant/resolver";
import { findTenantForWidgetKey } from "@/server/tenant/tenant-repository";
import { getWidgetRequestOrigin } from "@/server/widget/request-origin";
import { toPublicWidgetConfig } from "@/server/widget/widget-config";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const widgetKey = request.nextUrl.searchParams.get("key");
  if (!widgetKey) {
    return NextResponse.json(
      {
        error: {
          code: "WIDGET_KEY_REQUIRED",
          message: "Missing widget key."
        }
      },
      { status: 400 }
    );
  }

  const tenant = await findTenantForWidgetKey(widgetKey);
  const resolution = resolveWidgetTenant({
    widgetKey,
    origin: getWidgetRequestOrigin(request),
    tenants: tenant
      ? [
          {
            id: tenant.id,
            slug: tenant.slug,
            name: tenant.name,
            status: tenant.status,
            widgetPublicKey: tenant.widgetPublicKey,
            allowedOrigins: tenant.allowedOrigins
          }
        ]
      : []
  });

  if (!resolution.ok) {
    return NextResponse.json(
      {
        error: {
          code: resolution.code,
          message: resolution.message
        }
      },
      { status: resolution.code === "TENANT_NOT_FOUND" ? 404 : 403 }
    );
  }


  if (!tenant) {
    return NextResponse.json(
      {
        error: {
          code: "TENANT_NOT_FOUND",
          message: "No active tenant matches this widget key."
        }
      },
      { status: 404 }
    );
  }

  return NextResponse.json(toPublicWidgetConfig(tenant));
}
