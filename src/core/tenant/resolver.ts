export type ResolvableTenantStatus = "ACTIVE" | "SUSPENDED" | "DISABLED";

export interface ResolvableTenant {
  id: string;
  slug: string;
  name: string;
  status: ResolvableTenantStatus;
  widgetPublicKey: string;
  allowedOrigins: string[];
}

export type TenantResolutionErrorCode = "TENANT_NOT_FOUND" | "ORIGIN_NOT_ALLOWED";

export type TenantResolutionResult =
  | {
      ok: true;
      tenant: ResolvableTenant;
    }
  | {
      ok: false;
      code: TenantResolutionErrorCode;
      message: string;
    };

export interface ResolveWidgetTenantInput {
  widgetKey: string;
  origin: string | null;
  tenants: ResolvableTenant[];
}

export function resolveWidgetTenant(input: ResolveWidgetTenantInput): TenantResolutionResult {
  const tenant = input.tenants.find(
    (candidate) => candidate.status === "ACTIVE" && candidate.widgetPublicKey === input.widgetKey
  );

  if (!tenant) {
    return {
      ok: false,
      code: "TENANT_NOT_FOUND",
      message: "No active tenant matches this widget key."
    };
  }

  if (!input.origin || !tenant.allowedOrigins.includes(input.origin)) {
    return {
      ok: false,
      code: "ORIGIN_NOT_ALLOWED",
      message: "This origin is not allowed for the resolved tenant."
    };
  }

  return {
    ok: true,
    tenant
  };
}
