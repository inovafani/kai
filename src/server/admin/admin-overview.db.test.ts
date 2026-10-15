import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { clearTenantPickerCache, getAdminOverview, isTestFixtureTenantSlug, listRealTenantsForPicker } from "./admin-overview";

// Read-only checks against the real database: the one query that skips test fixtures inside the
// database must give the same answer the old load-everything-then-filter code gave.
describe("admin overview tenant loading", () => {
  it("returns exactly the non fixture tenants, with the same counts Prisma gives", async () => {
    const overview = await getAdminOverview();
    const shown = [...overview.tenants, ...overview.platformTenants];
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.some((tenant) => isTestFixtureTenantSlug(tenant.slug))).toBe(false);

    const expected = await prisma.tenant.findMany({
      where: { slug: { in: shown.map((tenant) => tenant.slug) } },
      select: { slug: true, kind: true, config: { select: { pmsProvider: true } }, _count: { select: { conversations: true, manualInquiries: true } } }
    });
    for (const tenant of shown) {
      const match = expected.find((row) => row.slug === tenant.slug)!;
      expect(tenant._count).toEqual(match._count);
      expect(tenant.kind).toBe(match.kind);
      expect(tenant.config?.pmsProvider ?? null).toBe(match.config?.pmsProvider ?? null);
    }

    const all = await prisma.tenant.findMany({ select: { slug: true } });
    const realCount = all.filter((row) => !isTestFixtureTenantSlug(row.slug)).length;
    expect(shown).toHaveLength(realCount);
    expect(overview.testFixtureCount).toBe(all.length - realCount);
    expect(overview.platformTenants.every((tenant) => tenant.kind === "PLATFORM")).toBe(true);
    expect(overview.tenants.every((tenant) => tenant.kind === "OPERATOR")).toBe(true);
  }, 120_000);

  it("lists every real tenant in the picker, active ones first, operators before BluePass's own chat, and remembers the answer", async () => {
    clearTenantPickerCache();
    const first = await listRealTenantsForPicker(1_000);
    expect(first.length).toBeGreaterThan(0);
    expect(first.some((tenant) => isTestFixtureTenantSlug(tenant.slug))).toBe(false);

    // The same tenants the overview shows, suspended ones included and marked.
    const overview = await getAdminOverview();
    expect(first.map((tenant) => tenant.slug).sort()).toEqual([...overview.tenants, ...overview.platformTenants].map((tenant) => tenant.slug).sort());
    const suspended = first.filter((tenant) => tenant.status !== "ACTIVE");
    for (const tenant of suspended) {
      const siblings = first.filter((other) => other.kind === tenant.kind);
      expect(siblings.indexOf(tenant)).toBeGreaterThanOrEqual(siblings.filter((other) => other.status === "ACTIVE").length);
    }

    const firstPlatform = first.findIndex((tenant) => tenant.kind === "PLATFORM");
    if (firstPlatform >= 0) expect(first.slice(firstPlatform).every((tenant) => tenant.kind === "PLATFORM")).toBe(true);

    // A second call inside the minute does not touch the database.
    const started = Date.now();
    const again = await listRealTenantsForPicker(1_000 + 30_000);
    expect(again).toBe(first);
    expect(Date.now() - started).toBeLessThan(50);
    clearTenantPickerCache();
  }, 120_000);
});
