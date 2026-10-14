import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { getAdminOverview } from "@/server/admin/admin-overview";
import { AdminFrame } from "./admin-ui";

// The operator switcher is a client component that navigates; there is no router when rendering to text.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

// The shell is read-only against the real database (it only looks up the operator list).
async function render(props: Parameters<typeof AdminFrame>[0]) {
  return renderToStaticMarkup(await AdminFrame(props));
}

describe("admin shell navigation", () => {
  it("shows no operator controls on a platform page", async () => {
    const html = await render({ active: "overview", children: "page" });
    expect(html).not.toContain("shell-picker");
    expect(html).not.toContain("adm-crumb");
    expect(html).not.toContain("/inquiries");
    expect(html).not.toContain("/settings");
    for (const label of ["Overview", "AI usage", "Background jobs"]) expect(html).toContain(label);
  });

  it("shows the operator's own entries, under its name, only on that operator's pages", async () => {
    const html = await render({ active: "inquiries", tenantSlug: "boattime", children: "page" });
    expect(html).toContain("Boattime Yacht Charters");
    expect(html).toContain('href="/admin/boattime/inquiries"');
    expect(html).toContain('href="/admin/boattime/settings"');
    expect(html).toContain("All operators");
    // The switcher sits above the page, not in the top bar.
    expect(html.indexOf("shell-picker")).toBeGreaterThan(html.indexOf("shell-main"));
    expect(html).toContain("Switch operator");
  });

  it("can open a suspended operator that is not in the switcher list", async () => {
    const html = await render({ active: "settings", tenantSlug: "dummy-marine-tours-test", children: "page" });
    expect(html).toContain('href="/admin/dummy-marine-tours-test/inquiries"');
    expect(html).toContain("dummy-marine-tours-test");
  });
});

describe("overview data", () => {
  it("lists the newest waiting inquiries with their operator", async () => {
    const overview = await getAdminOverview();
    expect(overview.waitingInquiries.length).toBeLessThanOrEqual(8);
    for (const inquiry of overview.waitingInquiries) {
      expect(inquiry.tenant.slug).toBeTruthy();
      expect(inquiry.conversationId).toBeTruthy();
    }
    const times = overview.waitingInquiries.map((inquiry) => inquiry.createdAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  }, 120_000);
});
