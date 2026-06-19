import { expect, test } from "@playwright/test";

const ADMIN_TOKEN = "dev-admin-token";

test("admin can open an inquiry conversation transcript", async ({ context, page, request }) => {
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

  const uniqueMessage = "private boat for 2 guests tomorrow transcript " + Date.now();
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
  await inquiryCard.getByRole("link", { name: "View conversation" }).click();

  await expect(page).toHaveURL(/\/admin\/kai-demo\/conversations\//);
  await expect(page.getByRole("heading", { name: "Conversation transcript" })).toBeVisible();
  await expect(page.getByText("Private Charter").first()).toBeVisible();
  await expect(page.getByText(uniqueMessage)).toBeVisible();
  await expect(page.getByText("Private Charter requires operator confirmation.")).toBeVisible();
  await expect(page.getByText("TRAVELLER").first()).toBeVisible();
  await expect(page.getByText("ASSISTANT").first()).toBeVisible();
});

test("admin conversation transcript requires an admin token", async ({ page, request }) => {
  const sessionResponse = await request.post("/api/widget/session", {
    headers: { origin: "http://localhost:3107" },
    data: { key: "pk_test_kai_demo" }
  });
  const session = await sessionResponse.json();

  await page.goto("/admin/kai-demo/conversations/" + session.conversation.id);

  await expect(page.getByRole("heading", { name: "Admin access" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conversation transcript" })).toHaveCount(0);
});
