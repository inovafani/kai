import { expect, test } from "@playwright/test";

test("widget config returns public config for allowed origin", async ({ request }) => {
  const response = await request.get("/api/widget/config?key=pk_test_kai_demo", {
    headers: {
      origin: "http://localhost:3107"
    }
  });

  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    tenant: {
      slug: "kai-demo",
      name: "Kai Demo",
      defaultLocale: "en"
    },
    branding: {
      widgetTitle: "Kai",
      primaryColor: "#0f766e"
    },
    capabilities: {
      supportedChannels: ["WEB_WIDGET"],
      pmsProvider: "MOCK"
    }
  });
});

test("widget config rejects disallowed origins", async ({ request }) => {
  const response = await request.get("/api/widget/config?key=pk_test_kai_demo", {
    headers: {
      origin: "https://evil.example.com"
    }
  });

  expect(response.status()).toBe(403);
  await expect(response.json()).resolves.toEqual({
    error: {
      code: "ORIGIN_NOT_ALLOWED",
      message: "This origin is not allowed for the resolved tenant."
    }
  });
});
