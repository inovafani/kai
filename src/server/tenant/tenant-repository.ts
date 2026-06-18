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
