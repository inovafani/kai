import { expect, test } from "@playwright/test";

test("home page and health route are reachable", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /white-label ai booking orchestration/i })).toBeVisible();

  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    service: "kai",
    version: "0.1.0"
  });
});
