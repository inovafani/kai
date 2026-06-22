import { expect, test } from "@playwright/test";

test("loader script opens and closes Kai from a launcher button", async ({ page }) => {
  await page.setContent(`
    <!doctype html>
    <html>
      <body>
        <main>
          <h1>Tenant website</h1>
          <script
            src="http://127.0.0.1:3107/embed/kai-loader.js"
            data-kai-key="pk_test_kai_demo"
          ></script>
        </main>
      </body>
    </html>
  `);

  const launcher = page.getByRole("button", { name: "Open Kai" });
  await expect(launcher).toBeVisible();
  await expect(page.locator("iframe[title=\"Kai booking assistant\"]")).toHaveCount(0);

  await launcher.click();

  const kaiFrameElement = page.locator("iframe[title=\"Kai booking assistant\"]");
  const kaiFrame = page.frameLocator("iframe[title=\"Kai booking assistant\"]");

  await expect(kaiFrameElement).toBeVisible();
  await expect(kaiFrame.getByRole("heading", { name: "Kai" })).toBeVisible();
  await expect(
    kaiFrame.getByText("Hi, I am Kai. How can I help with your booking?")
  ).toBeVisible();

  await kaiFrame.getByLabel("Message").fill("Show me tomorrow tours");
  await kaiFrame.getByRole("button", { name: "Send" }).click();

  await expect(kaiFrame.getByText("Show me tomorrow tours")).toBeVisible();
  await expect(kaiFrame.getByText("Kai is typing")).toBeVisible();
  await expect(kaiFrame.getByText("Kai is typing")).toBeHidden({ timeout: 20_000 });
  await expect(kaiFrame.getByLabel("Message")).toBeEnabled();

  await page.getByRole("button", { name: "Close Kai" }).click();

  await expect(kaiFrameElement).toHaveCount(0);
  await expect(launcher).toBeVisible();
});
