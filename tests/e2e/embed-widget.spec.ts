import { expect, test } from "@playwright/test";

test("embed widget loads tenant config and sends a message", async ({ page }) => {
  await page.route("**/api/widget/messages", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          id: "server-traveller-message",
          role: "TRAVELLER",
          content: "Can you help me book Komodo tomorrow?"
        },
        assistantMessage: {
          id: "server-assistant-message",
          role: "ASSISTANT",
          content: "Please share the guests so I can check safely."
        }
      })
    });
  });

  await page.goto("/embed/kai?key=pk_test_kai_demo");

  await expect(page.getByRole("heading", { name: "Kai" })).toBeVisible();
  await expect(page.getByText("Hi, I am Kai. How can I help with your booking?")).toBeVisible();

  await page.getByLabel("Message").fill("Can you help me book Komodo tomorrow?");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Can you help me book Komodo tomorrow?")).toBeVisible();
  await expect(page.getByText("Please share the guests so I can check safely.")).toBeVisible();
});

test("embed widget shows traveller message and Kai typing state immediately", async ({ page }) => {
  await page.route("**/api/widget/messages", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          id: "server-traveller-message",
          role: "TRAVELLER",
          content: "Can you check availability tomorrow?"
        },
        assistantMessage: {
          id: "server-assistant-message",
          role: "ASSISTANT",
          content: "Please share the product and number of guests so I can check safely."
        }
      })
    });
  });

  await page.goto("/embed/kai?key=pk_test_kai_demo");
  await page.getByLabel("Message").fill("Can you check availability tomorrow?");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Can you check availability tomorrow?")).toBeVisible();
  await expect(page.getByLabel("Kai is typing")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await expect(page.getByText("Please share the product and number of guests so I can check safely.")).toBeVisible();
  await expect(page.getByLabel("Kai is typing")).toHaveCount(0);
});
