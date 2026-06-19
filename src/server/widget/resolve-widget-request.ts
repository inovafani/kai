import { resolveWidgetTenant } from "@/core/tenant/resolver";
import { findTenantForWidgetKey } from "@/server/tenant/tenant-repository";

export async function resolveWidgetRequest(input: {
  widgetKey: string;
  origin: string | null;
}) {
  const tenant = await findTenantForWidgetKey(input.widgetKey);
  const resolution = resolveWidgetTenant({
    widgetKey: input.widgetKey,
    origin: input.origin,
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
    return {
      ok: false as const,
      error: {
        code: resolution.code,
        message: resolution.message
      },
      status: resolution.code === "TENANT_NOT_FOUND" ? 404 : 403
    };
  }

  if (!tenant) {
    return {
      ok: false as const,
      error: {
        code: "TENANT_NOT_FOUND",
        message: "No active tenant matches this widget key."
      },
      status: 404
    };
  }

  return {
    ok: true as const,
    tenant
  };
}
