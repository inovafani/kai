import type { PmsProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function findTenantForWidgetKey(widgetKey: string) {
  return prisma.tenant.findUnique({
    where: {
      widgetPublicKey: widgetKey
    },
    include: {
      branding: true,
      config: true
    }
  });
}


export async function findTenantSettingsBySlug(slug: string) {
  return prisma.tenant.findUnique({
    where: { slug },
    include: {
      branding: true,
      config: true,
      integrations: {
        orderBy: { provider: "asc" },
        select: {
          provider: true,
          status: true,
          updatedAt: true
        }
      }
    }
  });
}


export async function updateTenantOperationalSettings(input: {
  tenantSlug: string;
  allowedOrigins: string[];
  pmsProvider: PmsProvider;
  enabledFeatures: string[];
  responseGuardrails: string[];
}) {
  return prisma.tenant.update({
    where: { slug: input.tenantSlug },
    data: {
      allowedOrigins: input.allowedOrigins,
      config: {
        update: {
          pmsProvider: input.pmsProvider,
          enabledFeatures: input.enabledFeatures,
          responseGuardrails: input.responseGuardrails
        }
      }
    },
    include: {
      branding: true,
      config: true
    }
  });
}
