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

/** The same pattern as `TEST_FIXTURE_SLUG`, for the database to apply (Postgres regex). */
const TEST_FIXTURE_SQL_REGEX = "-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  status: "ACTIVE" | "SUSPENDED" | "DISABLED";
  kind: "OPERATOR" | "PLATFORM";
  pmsProvider: string | null;
  bookingWriteEnabled: boolean | null;
  conversations: number;
  manualInquiries: number;
};

/**
 * The real tenants, with the counts the overview shows, in ONE query that leaves the test fixtures
 * out inside the database. Automated tests have left over a thousand fixture tenants behind, and
 * loading all of them (each with two counts) just to throw them away was most of what an admin page
 * cost, on every click.
 */
async function listRealTenantRows(): Promise<TenantRow[]> {
  return prisma.$queryRaw<TenantRow[]>`
    SELECT t."id", t."slug", t."name", t."status"::text AS "status", t."kind"::text AS "kind",
           c."pmsProvider"::text AS "pmsProvider", c."bookingWriteEnabled" AS "bookingWriteEnabled",
           (SELECT count(*)::int FROM "Conversation" v WHERE v."tenantId" = t."id") AS "conversations",
           (SELECT count(*)::int FROM "ManualInquiry" m WHERE m."tenantId" = t."id") AS "manualInquiries"
    FROM "Tenant" t
    LEFT JOIN "TenantConfig" c ON c."tenantId" = t."id"
    WHERE t."slug" !~ ${TEST_FIXTURE_SQL_REGEX}
    ORDER BY t."createdAt" ASC`;
}

/** One row per real tenant for the overview page. Counts are plain totals, nothing estimated. */
export async function getAdminOverview() {
  const [realRows, tenantTotal, stats, latestCronRuns, openInquiries, waitingInquiries] = await Promise.all([
    listRealTenantRows(),
    prisma.tenant.count(),
    getPlatformStats(),
    prisma.cronRunLog.findMany({ orderBy: { finishedAt: "desc" }, take: 5 }),
    prisma.manualInquiry.count({ where: { status: "OPEN" } }),
    // The newest inquiries still waiting on a person, across every operator.
    prisma.manualInquiry.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        conversationId: true,
        productTitle: true,
        dateText: true,
        guests: true,
        travellerName: true,
        travellerMessage: true,
        createdAt: true,
        tenant: { select: { slug: true, name: true } }
      }
    })
  ]);

  const real = realRows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    kind: row.kind,
    config: row.pmsProvider === null ? null : { pmsProvider: row.pmsProvider, bookingWriteEnabled: Boolean(row.bookingWriteEnabled) },
    _count: { conversations: row.conversations, manualInquiries: row.manualInquiries }
  }));
  const testFixtureCount = tenantTotal - real.length;
  // Operators are the businesses that work with BluePass. A PLATFORM tenant is BluePass's own chat,
  // listed separately so it never reads as one more operator.
  const tenants = real.filter((tenant) => tenant.kind === "OPERATOR");
  const platformTenants = real.filter((tenant) => tenant.kind === "PLATFORM");

  return { tenants, platformTenants, testFixtureCount, stats, latestCronRuns, openInquiries, waitingInquiries };
}

export async function listCronRuns(limit = 50) {
  return prisma.cronRunLog.findMany({ orderBy: { finishedAt: "desc" }, take: limit });
}

type PickerTenant = { slug: string; name: string; kind: "OPERATOR" | "PLATFORM"; status: "ACTIVE" | "SUSPENDED" | "DISABLED" };
// The promise is kept, not just the answer, so a page can start the lookup before its own data
// arrives and the navigation frame then waits on the same one instead of asking again afterwards.
let pickerCache: { at: number; tenants: Promise<PickerTenant[]> } | null = null;
const PICKER_CACHE_MS = 60_000;

/**
 * Tenants for the picker: operators first (active before suspended, busiest inbox first), then
 * BluePass's own chat. Test fixtures are left out; suspended and disabled tenants stay in, marked as
 * such, so the picker lists the same tenants as the overview. Every admin page asks for this, and it
 * only changes when someone adds or suspends a tenant, so it is remembered for a minute.
 */
export function listRealTenantsForPicker(now = Date.now()): Promise<PickerTenant[]> {
  if (pickerCache && now - pickerCache.at < PICKER_CACHE_MS) return pickerCache.tenants;

  const tenants = prisma
    .$queryRaw<(PickerTenant & { manualInquiries: number })[]>`
    SELECT t."slug", t."name", t."kind"::text AS "kind", t."status"::text AS "status",
           (SELECT count(*)::int FROM "ManualInquiry" m WHERE m."tenantId" = t."id") AS "manualInquiries"
    FROM "Tenant" t
    WHERE t."slug" !~ ${TEST_FIXTURE_SQL_REGEX}
    ORDER BY t."createdAt" ASC`
    .then((rows) =>
      rows
        .sort(
          (x, y) =>
            Number(x.kind === "PLATFORM") - Number(y.kind === "PLATFORM") ||
            Number(x.status !== "ACTIVE") - Number(y.status !== "ACTIVE") ||
            y.manualInquiries - x.manualInquiries
        )
        .map((tenant) => ({ slug: tenant.slug, name: tenant.name, kind: tenant.kind, status: tenant.status }))
    );
  pickerCache = { at: now, tenants };
  // A failed lookup must not be remembered for a minute.
  tenants.catch(() => {
    if (pickerCache?.tenants === tenants) pickerCache = null;
  });
  return tenants;
}

/** Starts the picker lookup without waiting for it. Call it at the top of a page, before its own queries. */
export function warmTenantPicker() {
  void listRealTenantsForPicker().catch(() => undefined);
}

/** Tests only. */
export function clearTenantPickerCache() {
  pickerCache = null;
}
