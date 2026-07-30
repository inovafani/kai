import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: "boattime" }, include: { config: true } });
  if (!tenant) {
    console.log("No tenant with slug 'boattime' found.");
    return;
  }
  if (!tenant.config) {
    console.log("Tenant 'boattime' has no TenantConfig row yet - cannot toggle enabledFeatures.");
    return;
  }

  const current = tenant.config.enabledFeatures ?? [];
  if (current.includes("bluepass_stripe_pms_checkout")) {
    console.log("Already enabled for boattime. enabledFeatures:", current);
    return;
  }

  const updated = await prisma.tenantConfig.update({
    where: { tenantId: tenant.id },
    data: { enabledFeatures: [...current, "bluepass_stripe_pms_checkout"] }
  });

  console.log("Enabled. boattime enabledFeatures is now:", updated.enabledFeatures);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
