import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { PmsProvider as PrismaPmsProvider } from "@prisma/client";
import type { PmsProvider } from "@/core/tenant/types";

export type PmsAdapterEnvironment = Record<string, string | undefined>;

const ALGORITHM = "aes-256-gcm";

function resolveEncryptionKey(encryptionKey: string) {
  const key = Buffer.from(encryptionKey, "base64");
  if (key.length !== 32) {
    throw new Error("PMS_CREDENTIAL_ENCRYPTION_KEY must decode to a 32-byte key.");
  }

  return key;
}

export function encryptPmsCredentials(payload: Record<string, string>, encryptionKey: string): string {
  const key = resolveEncryptionKey(encryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptPmsCredentials(encrypted: string, encryptionKey: string): Record<string, string> {
  const key = resolveEncryptionKey(encryptionKey);
  const [ivPart, authTagPart, ciphertextPart] = encrypted.split(".");

  if (!ivPart || !authTagPart || !ciphertextPart) {
    throw new Error("Malformed encrypted PMS credential payload.");
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(authTagPart, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextPart, "base64")), decipher.final()]);

  return JSON.parse(plaintext.toString("utf8"));
}

function credentialsToRezdyEnv(credentials: Record<string, string>): PmsAdapterEnvironment {
  return {
    REZDY_BASE_URL: credentials.baseUrl,
    REZDY_API_KEY: credentials.apiKey,
    ...(credentials.productListPath ? { REZDY_PRODUCT_LIST_PATH: credentials.productListPath } : {}),
    ...(credentials.availabilityPath ? { REZDY_AVAILABILITY_PATH: credentials.availabilityPath } : {}),
    ...(credentials.bookingPath ? { REZDY_BOOKING_PATH: credentials.bookingPath } : {}),
    ...(credentials.timeoutMs ? { REZDY_TIMEOUT_MS: credentials.timeoutMs } : {})
  };
}

/**
 * Prefers a tenant's own encrypted TenantIntegration credentials over the shared global env vars.
 * Falls back to fallbackEnv (unchanged) whenever no active per-tenant row exists, so tenants without
 * one (e.g. boattime today) keep behaving exactly as before this existed.
 */
export async function resolveTenantPmsEnv(
  tenantId: string,
  provider: PmsProvider,
  fallbackEnv: PmsAdapterEnvironment
): Promise<PmsAdapterEnvironment> {
  if (provider !== "REZDY") {
    return fallbackEnv;
  }

  const encryptionKey = process.env.PMS_CREDENTIAL_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return fallbackEnv;
  }

  try {
    const integration = await prisma.tenantIntegration.findUnique({
      where: { tenantId_provider: { tenantId, provider: provider as PrismaPmsProvider } }
    });

    if (!integration || integration.status !== "ACTIVE") {
      return fallbackEnv;
    }

    const credentials = decryptPmsCredentials(integration.encryptedCredentials, encryptionKey);
    return { ...fallbackEnv, ...credentialsToRezdyEnv(credentials) };
  } catch (error) {
    console.error("tenant_pms_credentials.resolve_failed", {
      tenantId,
      provider,
      error: error instanceof Error ? error.message : String(error)
    });
    return fallbackEnv;
  }
}
