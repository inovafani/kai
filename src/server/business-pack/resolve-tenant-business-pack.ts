import { resolveBusinessPack } from "@/core/business-pack/registry";
import type { BusinessPackDescriptor } from "@/core/business-pack/types";
import type { BookingMode, PmsProvider } from "@/core/tenant/types";

type TenantBusinessPackInput = {
  id: string;
  slug: string;
  name: string;
  config: {
    enabledFeatures: string[];
    bookingMode: string;
    bookingWriteEnabled?: boolean;
    pmsProvider: PmsProvider;
  } | null;
};

export function resolveTenantBusinessPack(
  tenant: TenantBusinessPackInput,
): BusinessPackDescriptor {
  return resolveBusinessPack({
    tenantId: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    enabledFeatures: tenant.config?.enabledFeatures ?? [],
    bookingMode: (tenant.config?.bookingMode ?? "MANUAL_INQUIRY") as BookingMode,
    bookingWriteEnabled: tenant.config?.bookingWriteEnabled ?? false,
    pmsProvider: tenant.config?.pmsProvider ?? "MOCK",
  });
}
