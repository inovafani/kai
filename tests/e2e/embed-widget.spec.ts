import { expect, test } from "@playwright/test";

test("embed widget loads tenant config and sends a message", async ({ page }) => {
  await page.goto("/embed/kai?key=pk_test_kai_demo");

  await expect(page.getByRole("heading", { name: "Kai" })).toBeVisible();
  await expect(page.getByText("Hi, I am Kai. How can I help with your booking?")).toBeVisible();

  await page.getByLabel("Message").fill("Can you help me book Komodo tomorrow?");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Can you help me book Komodo tomorrow?")).toBeVisible();
  await expect(
    page.getByText(
      "I can help with that. Please share the guests so I can check safely."
    )
  ).toBeVisible();
});
