import { expect, test } from "@playwright/test";

test("demo tenant website loads Kai through the production loader", async ({ page }) => {
  await page.goto("/demo/tenant-site");

  await expect(page.getByRole("heading", { name: "BluePass Komodo Demo" })).toBeVisible();
  await expect(page.getByText("Private charters, island walks, and reef days.")).toBeVisible();

  const launcher = page.getByRole("button", { name: "Open Kai" });
  await expect(launcher).toBeVisible();

  await launcher.click();

  const kaiFrame = page.frameLocator('iframe[title="Kai booking assistant"]');

  await expect(kaiFrame.getByRole("heading", { name: "Kai" })).toBeVisible();
  await kaiFrame.getByLabel("Message").fill("Can you help me plan a Komodo trip?");
  await kaiFrame.getByRole("button", { name: "Send" }).click();

  await expect(kaiFrame.getByText("Can you help me plan a Komodo trip?")).toBeVisible();
});
