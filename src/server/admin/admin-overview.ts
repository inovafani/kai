import { prisma } from "@/lib/prisma";
import { getPlatformStats } from "./platform-stats";

/**
 * Automated tests create tenants whose slug ends in a random UUID. They are not operators, so the
 * overview counts them separately instead of burying the real ones.
 */
const TEST_FIXTURE_SLUG = /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isTestFixtureTenantSlug(slug: string) {
  return TEST_FIXTURE_SLUG.test(slug);
}

/** One row per real tenant for the overview page. Counts are plain totals, nothing estimated. */
export async function getAdminOverview() {
  const [allTenants, stats, latestCronRuns, openInquiries] = await Promise.all([
    prisma.tenant.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        config: { select: { pmsProvider: true, bookingWriteEnabled: true } },
        _count: { select: { conversations: true, manualInquiries: true } }
      }
    }),
    getPlatformStats(),
    prisma.cronRunLog.findMany({ orderBy: { finishedAt: "desc" }, take: 5 }),
    prisma.manualInquiry.count({ where: { status: "OPEN" } })
  ]);

  const tenants = allTenants.filter((tenant) => !isTestFixtureTenantSlug(tenant.slug));
  const testFixtureCount = allTenants.length - tenants.length;

  return { tenants, testFixtureCount, stats, latestCronRuns, openInquiries };
}

export async function listCronRuns(limit = 50) {
  return prisma.cronRunLog.findMany({ orderBy: { finishedAt: "desc" }, take: limit });
}

/** Active operators for the tenant picker, busiest inbox first. Test fixtures and suspended tenants are left out. */
export async function listRealTenantsForPicker() {
  const tenants = await prisma.tenant.findMany({
    where: { status: "ACTIVE" },
    select: { slug: true, name: true, _count: { select: { manualInquiries: true } } },
    orderBy: { createdAt: "asc" }
  });
  return tenants
    .filter((tenant) => !isTestFixtureTenantSlug(tenant.slug))
    .sort((a, b) => b._count.manualInquiries - a._count.manualInquiries)
    .map((tenant) => ({ slug: tenant.slug, name: tenant.name }));
}
