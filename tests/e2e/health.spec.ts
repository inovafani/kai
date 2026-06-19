import { expect, test } from "@playwright/test";

test("home page and health route are reachable", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /white-label ai booking orchestration/i })).toBeVisible();

  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);

  const body = await response.json();
  expect(body).toMatchObject({
    ok: true,
    service: "kai",
    version: "0.1.0"
  });
  expect(body.environment.missing).toEqual([]);
  expect(Array.isArray(body.environment.placeholders)).toBe(true);
});
