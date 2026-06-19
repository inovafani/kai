import { expect, test } from "@playwright/test";

const ADMIN_TOKEN = "dev-admin-token";

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "kai_admin_token",
      value: ADMIN_TOKEN,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    }
  ]);
});


test("admin inquiry inbox shows manual inquiries created by Kai", async ({ page, request }) => {
  const sessionResponse = await request.post("/api/widget/session", {
    headers: { origin: "http://localhost:3107" },
    data: { key: "pk_test_kai_demo" }
  });
  const session = await sessionResponse.json();

  await request.post("/api/widget/messages", {
    headers: { origin: "http://localhost:3107" },
    data: {
      key: "pk_test_kai_demo",
      conversationId: session.conversation.id,
      content: "private boat for 2 guests tomorrow"
    }
  });

  await page.goto("/admin/kai-demo/inquiries");

  await expect(page.getByRole("heading", { name: "Manual inquiries" })).toBeVisible();
  await expect(page.getByText("Private Charter").first()).toBeVisible();
  await expect(page.getByText("OPEN").first()).toBeVisible();
  await expect(page.getByText("tomorrow").first()).toBeVisible();
  await expect(page.getByText("2 guests").first()).toBeVisible();
});


test("admin can move a manual inquiry through operator statuses", async ({ page, request }) => {
  const uniqueMessage = "private boat for 2 guests tomorrow admin action " + Date.now();
  const sessionResponse = await request.post("/api/widget/session", {
    headers: { origin: "http://localhost:3107" },
    data: { key: "pk_test_kai_demo" }
  });
  const session = await sessionResponse.json();

  await request.post("/api/widget/messages", {
    headers: { origin: "http://localhost:3107" },
    data: {
      key: "pk_test_kai_demo",
      conversationId: session.conversation.id,
      content: uniqueMessage
    }
  });

  await page.goto("/admin/kai-demo/inquiries");

  const inquiryCard = page.locator("article").filter({ hasText: uniqueMessage });
  await expect(inquiryCard.getByText("OPEN")).toBeVisible();

  await inquiryCard.getByRole("button", { name: "Mark notified" }).click();
  await expect(page.locator("article").filter({ hasText: uniqueMessage }).getByText("OPERATOR_NOTIFIED")).toBeVisible();

  await page.locator("article").filter({ hasText: uniqueMessage }).getByRole("button", { name: "Close" }).click();
  await expect(page.locator("article").filter({ hasText: uniqueMessage }).getByText("CLOSED")).toBeVisible();
});


test("admin inquiry inbox requires an admin token", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3107" });
  const page = await context.newPage();

  await page.goto("/admin/kai-demo/inquiries");

  await expect(page.getByRole("heading", { name: "Admin access" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Manual inquiries" })).toHaveCount(0);
  await context.close();
});


test("legacy admin inquiry route redirects to the demo tenant inbox", async ({ page }) => {
  await page.goto("/admin/inquiries");
  await expect(page).toHaveURL(/\/admin\/kai-demo\/inquiries$/);
  await expect(page.getByRole("heading", { name: "Manual inquiries" })).toBeVisible();
});
