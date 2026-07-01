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

test("widget config returns BluePass marketplace business pack", async ({ request }) => {
  const response = await request.get("/api/widget/config?key=pk_test_bluepass", {
    headers: {
      origin: "https://bluepass.co"
    }
  });

  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    tenant: {
      slug: "bluepass",
      name: "BluePass"
    },
    capabilities: {
      supportedChannels: ["WEB_WIDGET", "WHATSAPP"],
      pmsProvider: "NATIVE"
    },
    businessPack: {
      kind: "bluepass_marketplace",
      paymentPolicy: "operator_acceptance_required",
      tools: [
        "search_bluepass_yachts",
        "create_bluepass_inquiry",
        "sync_referral_ledger_estimate",
        "dispatch_operator_whatsapp",
        "get_bluepass_inquiry_status",
        "handoff_to_operator"
      ],
      truthPolicy: {
        availabilitySource: "preview_catalog",
        priceSource: "preview_catalog",
        bookingConfirmationSource: "operator_admin"
      }
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
