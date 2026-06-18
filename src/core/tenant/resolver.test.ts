import { describe, expect, it } from "vitest";
import { resolveWidgetTenant } from "./resolver";

const activeTenant = {
  id: "tenant_1",
  slug: "kai-demo",
  name: "Kai Demo",
  status: "ACTIVE" as const,
  widgetPublicKey: "pk_test_kai_demo",
  allowedOrigins: ["https://demo.example.com", "http://localhost:3107"]
};

describe("resolveWidgetTenant", () => {
  it("resolves an active tenant when widget key and origin match", () => {
    const result = resolveWidgetTenant({
      widgetKey: "pk_test_kai_demo",
      origin: "https://demo.example.com",
      tenants: [activeTenant]
    });

    expect(result).toEqual({
      ok: true,
      tenant: activeTenant
    });
  });

  it("rejects unknown widget keys", () => {
    const result = resolveWidgetTenant({
      widgetKey: "pk_unknown",
      origin: "https://demo.example.com",
      tenants: [activeTenant]
    });

    expect(result).toEqual({
      ok: false,
      code: "TENANT_NOT_FOUND",
      message: "No active tenant matches this widget key."
    });
  });

  it("rejects disallowed origins", () => {
    const result = resolveWidgetTenant({
      widgetKey: "pk_test_kai_demo",
      origin: "https://evil.example.com",
      tenants: [activeTenant]
    });

    expect(result).toEqual({
      ok: false,
      code: "ORIGIN_NOT_ALLOWED",
      message: "This origin is not allowed for the resolved tenant."
    });
  });

  it("rejects disabled tenants", () => {
    const result = resolveWidgetTenant({
      widgetKey: "pk_test_kai_demo",
      origin: "https://demo.example.com",
      tenants: [{ ...activeTenant, status: "DISABLED" }]
    });

    expect(result).toEqual({
      ok: false,
      code: "TENANT_NOT_FOUND",
      message: "No active tenant matches this widget key."
    });
  });
});
