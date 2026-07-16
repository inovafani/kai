import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { decryptPmsCredentials, encryptPmsCredentials, resolveTenantPmsEnv } from "./tenant-pms-credentials";

const originalEnv = { ...process.env };

function generateTestEncryptionKey() {
  return randomBytes(32).toString("base64");
}

async function createTestTenant() {
  return prisma.tenant.create({
    data: {
      slug: `pms-credentials-test-${randomUUID()}`,
      name: "PMS Credentials Test Tenant",
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["http://localhost:3107"],
      status: "ACTIVE"
    }
  });
}

beforeEach(() => {
  delete process.env.PMS_CREDENTIAL_ENCRYPTION_KEY;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("tenant PMS credentials", () => {
  it("round-trips credentials through encryption and decryption", () => {
    const key = generateTestEncryptionKey();
    const payload = { baseUrl: "https://api.rezdy.com", apiKey: "rezdy-secret-123" };

    const encrypted = encryptPmsCredentials(payload, key);
    expect(encrypted).not.toContain("rezdy-secret-123");
    expect(decryptPmsCredentials(encrypted, key)).toEqual(payload);
  });

  it("returns the fallback env untouched when no TenantIntegration row exists", async () => {
    process.env.PMS_CREDENTIAL_ENCRYPTION_KEY = generateTestEncryptionKey();
    const tenant = await createTestTenant();
    const fallbackEnv = { REZDY_BASE_URL: "https://global.example.test", REZDY_API_KEY: "global-key" };

    const resolved = await resolveTenantPmsEnv(tenant.id, "REZDY", fallbackEnv);

    expect(resolved).toEqual(fallbackEnv);
  });

  it("returns decrypted per-tenant credentials when an active TenantIntegration row exists", async () => {
    const encryptionKey = generateTestEncryptionKey();
    process.env.PMS_CREDENTIAL_ENCRYPTION_KEY = encryptionKey;
    const tenant = await createTestTenant();
    const tenantCredentials = {
      baseUrl: "https://tenant-specific.rezdy.test",
      apiKey: "tenant-specific-secret",
      productListPath: "/v1/products"
    };

    await prisma.tenantIntegration.create({
      data: {
        tenantId: tenant.id,
        provider: "REZDY",
        encryptedCredentials: encryptPmsCredentials(tenantCredentials, encryptionKey),
        status: "ACTIVE"
      }
    });

    const fallbackEnv = { REZDY_BASE_URL: "https://global.example.test", REZDY_API_KEY: "global-key" };
    const resolved = await resolveTenantPmsEnv(tenant.id, "REZDY", fallbackEnv);

    expect(resolved).toMatchObject({
      REZDY_BASE_URL: "https://tenant-specific.rezdy.test",
      REZDY_API_KEY: "tenant-specific-secret",
      REZDY_PRODUCT_LIST_PATH: "/v1/products"
    });
  });

  it("ignores a non-ACTIVE TenantIntegration row and falls back", async () => {
    const encryptionKey = generateTestEncryptionKey();
    process.env.PMS_CREDENTIAL_ENCRYPTION_KEY = encryptionKey;
    const tenant = await createTestTenant();

    await prisma.tenantIntegration.create({
      data: {
        tenantId: tenant.id,
        provider: "REZDY",
        encryptedCredentials: encryptPmsCredentials({ baseUrl: "https://x.test", apiKey: "y" }, encryptionKey),
        status: "DISABLED"
      }
    });

    const fallbackEnv = { REZDY_BASE_URL: "https://global.example.test" };
    const resolved = await resolveTenantPmsEnv(tenant.id, "REZDY", fallbackEnv);

    expect(resolved).toEqual(fallbackEnv);
  });

  it("returns the fallback env for non-REZDY providers even if a row exists", async () => {
    const encryptionKey = generateTestEncryptionKey();
    process.env.PMS_CREDENTIAL_ENCRYPTION_KEY = encryptionKey;
    const tenant = await createTestTenant();
    const fallbackEnv = { INSEANQ_BASE_URL: "https://global-inseanq.example.test" };

    const resolved = await resolveTenantPmsEnv(tenant.id, "INSEANQ", fallbackEnv);

    expect(resolved).toEqual(fallbackEnv);
  });

  it("returns the fallback env when the encryption key env var is not configured", async () => {
    const tenant = await createTestTenant();
    const fallbackEnv = { REZDY_BASE_URL: "https://global.example.test" };

    const resolved = await resolveTenantPmsEnv(tenant.id, "REZDY", fallbackEnv);

    expect(resolved).toEqual(fallbackEnv);
  });
});
