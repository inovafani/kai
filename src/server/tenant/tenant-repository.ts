import type { Prisma, PmsProvider } from "@prisma/client";
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
  publicProductCatalog: unknown;
  bookingWriteEnabled: boolean;
  enabledFeatures: string[];
  responseGuardrails: string[];
  brandVoice?: string;
}) {
  return prisma.tenant.update({
    where: { slug: input.tenantSlug },
    data: {
      allowedOrigins: input.allowedOrigins,
      branding: input.brandVoice === undefined
        ? undefined
        : {
            update: {
              brandVoice: input.brandVoice
            }
          },
      config: {
        update: {
          pmsProvider: input.pmsProvider,
          publicProductCatalog: input.publicProductCatalog as Prisma.InputJsonValue,
          bookingWriteEnabled: input.bookingWriteEnabled,
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
