import { expect, test } from "@playwright/test";

test("Boattime local demo loads its tenant widget and PMS catalog", async ({ page }) => {
  await page.goto("/demo/boattime");

  await expect(page.getByRole("heading", { name: "Gold Coast yacht charters and premium cruises." })).toBeVisible();
  await expect(page.getByText("Boattime Yacht Charters").first()).toBeVisible();

  await page.getByRole("button", { name: "Open Kai" }).click();
  const kaiFrame = page.frameLocator('iframe[title="Kai booking assistant"]');

  await expect(kaiFrame.getByText("Boattime Yacht Charters · REZDY")).toBeVisible({ timeout: 15000 });
  await kaiFrame.getByLabel("Message").fill("do you have recommendation for me tomorrow?");
  await kaiFrame.getByRole("button", { name: "Send" }).click();

  await expect(kaiFrame.getByText("Gold Coast Whale Escape")).toBeVisible({ timeout: 15000 });
  await expect(kaiFrame.getByText("Private Yacht Charter")).toBeVisible();
  await expect(kaiFrame.getByText("Komodo Day Trip")).toHaveCount(0);
});
