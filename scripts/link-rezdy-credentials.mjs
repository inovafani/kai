import { createCipheriv, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      args[match[1]] = match[2];
    }
  }
  return args;
}

function encryptPmsCredentials(payload, encryptionKey) {
  const key = Buffer.from(encryptionKey, "base64");
  if (key.length !== 32) {
    throw new Error("PMS_CREDENTIAL_ENCRYPTION_KEY must decode to a 32-byte key.");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

// Reads the currently-configured global REZDY_* env vars and stores them, encrypted, as this
// tenant's own TenantIntegration row - so it resolves through the per-tenant path instead of the
// shared global env vars. Re-run with a different tenant's own real credentials in the environment
// to onboard a distinct Rezdy operator later; nothing else in the codebase needs to change.
async function main() {
  const { slug, provider = "REZDY" } = parseArgs(process.argv.slice(2));

  if (!slug) {
    throw new Error("Usage: node scripts/link-rezdy-credentials.mjs --slug=<tenant-slug>");
  }

  const encryptionKey = process.env.PMS_CREDENTIAL_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("PMS_CREDENTIAL_ENCRYPTION_KEY is required in the environment to run this script.");
  }

  const credentials = {
    baseUrl: process.env.REZDY_BASE_URL ?? "",
    apiKey: process.env.REZDY_API_KEY ?? "",
    productListPath: process.env.REZDY_PRODUCT_LIST_PATH ?? "",
    availabilityPath: process.env.REZDY_AVAILABILITY_PATH ?? "",
    bookingPath: process.env.REZDY_BOOKING_PATH ?? "",
    ...(process.env.REZDY_TIMEOUT_MS ? { timeoutMs: process.env.REZDY_TIMEOUT_MS } : {})
  };

  if (!credentials.baseUrl || !credentials.apiKey) {
    throw new Error("REZDY_BASE_URL and REZDY_API_KEY must be set in the environment before running this script.");
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    throw new Error(`No tenant found with slug "${slug}". Run "npm run db:seed" first.`);
  }

  const encryptedCredentials = encryptPmsCredentials(credentials, encryptionKey);

  await prisma.tenantIntegration.upsert({
    where: { tenantId_provider: { tenantId: tenant.id, provider } },
    update: { encryptedCredentials, status: "ACTIVE" },
    create: { tenantId: tenant.id, provider, encryptedCredentials, status: "ACTIVE" }
  });

  console.log(`Linked ${provider} credentials to tenant "${slug}" (${tenant.id}).`);
}

main()
  .catch((error) => {
    console.error(error.message ?? error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
