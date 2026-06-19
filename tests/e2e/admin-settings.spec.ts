import { expect, test } from "@playwright/test";

const ADMIN_TOKEN = "dev-admin-token";

test("admin tenant settings shows tenant configuration", async ({ context, page }) => {
  await context.addCookies([
    {
      name: "kai_admin_token",
      value: ADMIN_TOKEN,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    },
    {
      name: "kai_admin_token",
      value: ADMIN_TOKEN,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    }
  ]);

  await page.goto("/admin/kai-demo/settings");

  await expect(page.getByRole("heading", { name: "Tenant settings" })).toBeVisible();
  await expect(page.getByText("Kai Demo", { exact: true })).toBeVisible();
  await expect(page.getByLabel("PMS provider")).toBeVisible();
  await expect(page.getByText("pk_test_kai_demo")).toBeVisible();
  await expect(page.getByText("http://localhost:3107", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("widget_config", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("Do not invent availability.", { exact: true }).last()).toBeVisible();
});

test("admin tenant settings requires an admin token", async ({ page }) => {
  await page.goto("/admin/kai-demo/settings");

  await expect(page.getByRole("heading", { name: "Admin access" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tenant settings" })).toHaveCount(0);
});


test("admin can update tenant operational settings", async ({ context, page, request }) => {
  await context.addCookies([
    {
      name: "kai_admin_token",
      value: ADMIN_TOKEN,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    },
    {
      name: "kai_admin_token",
      value: ADMIN_TOKEN,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    }
  ]);

  await page.goto("/admin/kai-demo/settings");

  await page.getByLabel("Allowed origins").fill("http://localhost:3107\nhttp://127.0.0.1:3107\nhttps://example-tenant.test");
  await page.getByLabel("PMS provider").selectOption("REZDY");
  await page.getByLabel("Enabled features").fill("widget_config\nmock_pms\nadmin_settings_editor");
  await page.getByRole("button", { name: "Save settings" }).click();

  await expect(page.getByText("Settings saved")).toBeVisible();
  await expect(page.getByText("REZDY", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("https://example-tenant.test", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("admin_settings_editor", { exact: true }).last()).toBeVisible();

  const widgetConfigResponse = await request.get("/api/widget/config?key=pk_test_kai_demo", {
    headers: { origin: "https://example-tenant.test" }
  });
  expect(widgetConfigResponse.ok()).toBe(true);

  await page.getByLabel("Allowed origins").fill("http://localhost:3107\nhttp://127.0.0.1:3107");
  await page.getByLabel("PMS provider").selectOption("MOCK");
  await page.getByLabel("Enabled features").fill("widget_config\nmock_pms");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("MOCK", { exact: true }).last()).toBeVisible();
});
