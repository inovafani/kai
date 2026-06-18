# Kai Tenant Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first tenant-safe SaaS foundation: database migration, seeded tenant configuration, tenant resolver, and public widget config endpoint.

**Architecture:** Tenant resolution is the first security boundary. The widget public key identifies a tenant, the request origin must be allowed for that tenant, and only then may Kai return public branding/config. The implementation keeps tenant-resolution logic testable as pure TypeScript, then wires it to Prisma and the Next.js API route.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, Supabase Postgres, Vitest, Zod.

---

## File Structure

- Modify `prisma/schema.prisma`: add widget key, allowed origins, default locale, and PMS provider fields required for public tenant resolution.
- Create `src/lib/prisma.ts`: shared Prisma client.
- Create `scripts/seed-first-tenant.mjs`: idempotent local seed for the first Kai tenant.
- Modify `package.json`: add `db:migrate`, `db:seed`, and `db:studio` scripts.
- Create `src/core/tenant/resolver.ts`: pure tenant resolver with origin validation.
- Create `src/core/tenant/resolver.test.ts`: tenant resolver tests.
- Create `src/server/tenant/tenant-repository.ts`: Prisma-backed tenant lookup.
- Create `src/server/widget/widget-config.ts`: converts tenant records into public widget config payloads.
- Create `src/server/widget/widget-config.test.ts`: public payload tests.
- Create `src/app/api/widget/config/route.ts`: public widget configuration endpoint.
- Create `tests/e2e/widget-config.spec.ts`: e2e smoke test for seeded widget config.

## Task 1: Extend Prisma Schema for Tenant Resolution

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Modify `Tenant` and `TenantConfig` in `prisma/schema.prisma`**

Replace the existing `Tenant` model with:

```prisma
model Tenant {
  id              String       @id @default(cuid())
  slug            String       @unique
  name            String
  status          TenantStatus @default(ACTIVE)
  widgetPublicKey String       @unique
  allowedOrigins  String[]
  defaultLocale   String       @default("en")
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  branding      TenantBranding?
  config        TenantConfig?
  integrations  TenantIntegration[]
  conversations Conversation[]
}
```

Replace the existing `TenantConfig` model with:

```prisma
model TenantConfig {
  id                 String      @id @default(cuid())
  tenantId           String      @unique
  supportedChannels  String[]
  enabledFeatures    String[]
  requiredSlots      Json
  bookingMode        String
  pmsProvider        PmsProvider @default(MOCK)
  escalationRules    String[]
  responseGuardrails String[]
  createdAt          DateTime    @default(now())
  updatedAt          DateTime    @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: Run Prisma validation**

Run:

```bash
npx prisma validate
```

Expected: PASS with `The schema at prisma/schema.prisma is valid`.

- [ ] **Step 3: Run the Supabase migration**

Run:

```bash
npx prisma migrate dev --name tenant_foundation
```

Expected: Prisma creates `prisma/migrations/<timestamp>_tenant_foundation/migration.sql`, applies it to Supabase, and regenerates the Prisma client.

- [ ] **Step 4: Commit schema and migration**

```bash
git add prisma/schema.prisma prisma/migrations package-lock.json package.json
git commit -m "feat: add tenant foundation schema"
```

## Task 2: Add Prisma Client and Seed First Tenant

**Files:**
- Create: `src/lib/prisma.ts`
- Create: `scripts/seed-first-tenant.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create `src/lib/prisma.ts`**

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 2: Add database scripts to `package.json`**

Update the `scripts` section to include:

```json
"db:migrate": "prisma migrate dev",
"db:seed": "node scripts/seed-first-tenant.mjs",
"db:studio": "prisma studio"
```

Keep the existing scripts.

- [ ] **Step 3: Create `scripts/seed-first-tenant.mjs`**

```js
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const tenant = {
  slug: "kai-demo",
  name: "Kai Demo",
  widgetPublicKey: "pk_test_kai_demo",
  allowedOrigins: ["http://localhost:3107", "http://127.0.0.1:3107"],
  defaultLocale: "en"
};

async function main() {
  const record = await prisma.tenant.upsert({
    where: { slug: tenant.slug },
    update: {
      name: tenant.name,
      widgetPublicKey: tenant.widgetPublicKey,
      allowedOrigins: tenant.allowedOrigins,
      defaultLocale: tenant.defaultLocale,
      status: "ACTIVE",
      branding: {
        upsert: {
          create: {
            logoUrl: null,
            primaryColor: "#0f766e",
            widgetTitle: "Kai",
            welcomeMessage: "Hi, I am Kai. How can I help with your booking?",
            brandVoice: "Warm, concise, practical, and grounded in tenant data."
          },
          update: {
            logoUrl: null,
            primaryColor: "#0f766e",
            widgetTitle: "Kai",
            welcomeMessage: "Hi, I am Kai. How can I help with your booking?",
            brandVoice: "Warm, concise, practical, and grounded in tenant data."
          }
        }
      },
      config: {
        upsert: {
          create: {
            supportedChannels: ["WEB_WIDGET"],
            enabledFeatures: ["widget_config", "mock_pms"],
            requiredSlots: {
              instantBooking: ["productId", "date", "guests", "travellerName", "travellerEmail"],
              inquiry: ["productId", "date", "guests", "travellerName", "travellerEmail", "notes"]
            },
            bookingMode: "MANUAL_INQUIRY",
            pmsProvider: "MOCK",
            escalationRules: ["human_requested", "custom_quote", "safety_or_refund"],
            responseGuardrails: [
              "Do not invent availability.",
              "Do not invent final prices.",
              "Do not confirm a booking without a booking tool result."
            ]
          },
          update: {
            supportedChannels: ["WEB_WIDGET"],
            enabledFeatures: ["widget_config", "mock_pms"],
            requiredSlots: {
              instantBooking: ["productId", "date", "guests", "travellerName", "travellerEmail"],
              inquiry: ["productId", "date", "guests", "travellerName", "travellerEmail", "notes"]
            },
            bookingMode: "MANUAL_INQUIRY",
            pmsProvider: "MOCK",
            escalationRules: ["human_requested", "custom_quote", "safety_or_refund"],
            responseGuardrails: [
              "Do not invent availability.",
              "Do not invent final prices.",
              "Do not confirm a booking without a booking tool result."
            ]
          }
        }
      }
    },
    create: {
      ...tenant,
      status: "ACTIVE",
      branding: {
        create: {
          logoUrl: null,
          primaryColor: "#0f766e",
          widgetTitle: "Kai",
          welcomeMessage: "Hi, I am Kai. How can I help with your booking?",
          brandVoice: "Warm, concise, practical, and grounded in tenant data."
        }
      },
      config: {
        create: {
          supportedChannels: ["WEB_WIDGET"],
          enabledFeatures: ["widget_config", "mock_pms"],
          requiredSlots: {
            instantBooking: ["productId", "date", "guests", "travellerName", "travellerEmail"],
            inquiry: ["productId", "date", "guests", "travellerName", "travellerEmail", "notes"]
          },
          bookingMode: "MANUAL_INQUIRY",
          pmsProvider: "MOCK",
          escalationRules: ["human_requested", "custom_quote", "safety_or_refund"],
          responseGuardrails: [
            "Do not invent availability.",
            "Do not invent final prices.",
            "Do not confirm a booking without a booking tool result."
          ]
        }
      }
    }
  });

  console.log(`Seeded tenant ${record.slug} with widget key ${record.widgetPublicKey}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 4: Run seed script**

Run:

```bash
npm run db:seed
```

Expected: prints `Seeded tenant kai-demo with widget key pk_test_kai_demo`.

- [ ] **Step 5: Commit Prisma client and seed**

```bash
git add package.json package-lock.json src/lib/prisma.ts scripts/seed-first-tenant.mjs
git commit -m "feat: seed first Kai tenant"
```

## Task 3: Add Pure Tenant Resolver with TDD

**Files:**
- Create: `src/core/tenant/resolver.test.ts`
- Create: `src/core/tenant/resolver.ts`

- [ ] **Step 1: Write failing tests in `src/core/tenant/resolver.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm run test -- src/core/tenant/resolver.test.ts
```

Expected: FAIL because `./resolver` does not exist.

- [ ] **Step 3: Create `src/core/tenant/resolver.ts`**

```ts
export type ResolvableTenantStatus = "ACTIVE" | "SUSPENDED" | "DISABLED";

export interface ResolvableTenant {
  id: string;
  slug: string;
  name: string;
  status: ResolvableTenantStatus;
  widgetPublicKey: string;
  allowedOrigins: string[];
}

export type TenantResolutionErrorCode = "TENANT_NOT_FOUND" | "ORIGIN_NOT_ALLOWED";

export type TenantResolutionResult =
  | {
      ok: true;
      tenant: ResolvableTenant;
    }
  | {
      ok: false;
      code: TenantResolutionErrorCode;
      message: string;
    };

export interface ResolveWidgetTenantInput {
  widgetKey: string;
  origin: string | null;
  tenants: ResolvableTenant[];
}

export function resolveWidgetTenant(input: ResolveWidgetTenantInput): TenantResolutionResult {
  const tenant = input.tenants.find(
    (candidate) => candidate.status === "ACTIVE" && candidate.widgetPublicKey === input.widgetKey
  );

  if (!tenant) {
    return {
      ok: false,
      code: "TENANT_NOT_FOUND",
      message: "No active tenant matches this widget key."
    };
  }

  if (!input.origin || !tenant.allowedOrigins.includes(input.origin)) {
    return {
      ok: false,
      code: "ORIGIN_NOT_ALLOWED",
      message: "This origin is not allowed for the resolved tenant."
    };
  }

  return {
    ok: true,
    tenant
  };
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
npm run test -- src/core/tenant/resolver.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit tenant resolver**

```bash
git add src/core/tenant/resolver.ts src/core/tenant/resolver.test.ts
git commit -m "feat: add widget tenant resolver"
```

## Task 4: Add Prisma Tenant Repository

**Files:**
- Create: `src/server/tenant/tenant-repository.ts`

- [ ] **Step 1: Create `src/server/tenant/tenant-repository.ts`**

```ts
import { prisma } from "@/lib/prisma";

export async function findTenantForWidgetKey(widgetKey: string) {
  return prisma.tenant.findUnique({
    where: {
      widgetPublicKey: widgetKey
    },
    include: {
      branding: true,
      config: true
    }
  });
}
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit repository**

```bash
git add src/server/tenant/tenant-repository.ts
git commit -m "feat: add tenant repository"
```

## Task 5: Add Public Widget Config Presenter with TDD

**Files:**
- Create: `src/server/widget/widget-config.test.ts`
- Create: `src/server/widget/widget-config.ts`

- [ ] **Step 1: Write failing tests in `src/server/widget/widget-config.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { toPublicWidgetConfig } from "./widget-config";

describe("toPublicWidgetConfig", () => {
  it("returns only public tenant config", () => {
    const config = toPublicWidgetConfig({
      id: "tenant_1",
      slug: "kai-demo",
      name: "Kai Demo",
      defaultLocale: "en",
      branding: {
        logoUrl: null,
        primaryColor: "#0f766e",
        widgetTitle: "Kai",
        welcomeMessage: "Hi, I am Kai. How can I help with your booking?",
        brandVoice: "Warm and concise."
      },
      config: {
        supportedChannels: ["WEB_WIDGET"],
        enabledFeatures: ["widget_config", "mock_pms"],
        bookingMode: "MANUAL_INQUIRY",
        pmsProvider: "MOCK"
      }
    });

    expect(config).toEqual({
      tenant: {
        slug: "kai-demo",
        name: "Kai Demo",
        defaultLocale: "en"
      },
      branding: {
        logoUrl: null,
        primaryColor: "#0f766e",
        widgetTitle: "Kai",
        welcomeMessage: "Hi, I am Kai. How can I help with your booking?"
      },
      capabilities: {
        supportedChannels: ["WEB_WIDGET"],
        enabledFeatures: ["widget_config", "mock_pms"],
        bookingMode: "MANUAL_INQUIRY",
        pmsProvider: "MOCK"
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm run test -- src/server/widget/widget-config.test.ts
```

Expected: FAIL because `./widget-config` does not exist.

- [ ] **Step 3: Create `src/server/widget/widget-config.ts`**

```ts
import type { BookingMode, PmsProvider } from "@/core/tenant/types";

interface WidgetTenantInput {
  id: string;
  slug: string;
  name: string;
  defaultLocale: string;
  branding: {
    logoUrl: string | null;
    primaryColor: string;
    widgetTitle: string;
    welcomeMessage: string;
    brandVoice: string;
  } | null;
  config: {
    supportedChannels: string[];
    enabledFeatures: string[];
    bookingMode: string;
    pmsProvider: PmsProvider;
  } | null;
}

export function toPublicWidgetConfig(tenant: WidgetTenantInput) {
  return {
    tenant: {
      slug: tenant.slug,
      name: tenant.name,
      defaultLocale: tenant.defaultLocale
    },
    branding: {
      logoUrl: tenant.branding?.logoUrl ?? null,
      primaryColor: tenant.branding?.primaryColor ?? "#0f766e",
      widgetTitle: tenant.branding?.widgetTitle ?? tenant.name,
      welcomeMessage: tenant.branding?.welcomeMessage ?? "Hi, I am Kai. How can I help?"
    },
    capabilities: {
      supportedChannels: tenant.config?.supportedChannels ?? ["WEB_WIDGET"],
      enabledFeatures: tenant.config?.enabledFeatures ?? [],
      bookingMode: (tenant.config?.bookingMode ?? "MANUAL_INQUIRY") as BookingMode,
      pmsProvider: tenant.config?.pmsProvider ?? "MOCK"
    }
  };
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
npm run test -- src/server/widget/widget-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit widget config presenter**

```bash
git add src/server/widget/widget-config.ts src/server/widget/widget-config.test.ts
git commit -m "feat: add public widget config presenter"
```

## Task 6: Add Widget Config API Route

**Files:**
- Create: `src/app/api/widget/config/route.ts`

- [ ] **Step 1: Create `src/app/api/widget/config/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { resolveWidgetTenant } from "@/core/tenant/resolver";
import { findTenantForWidgetKey } from "@/server/tenant/tenant-repository";
import { toPublicWidgetConfig } from "@/server/widget/widget-config";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const widgetKey = request.nextUrl.searchParams.get("key");
  const origin = request.headers.get("origin");

  if (!widgetKey) {
    return NextResponse.json(
      {
        error: {
          code: "WIDGET_KEY_REQUIRED",
          message: "Missing widget key."
        }
      },
      { status: 400 }
    );
  }

  const tenant = await findTenantForWidgetKey(widgetKey);
  const resolution = resolveWidgetTenant({
    widgetKey,
    origin,
    tenants: tenant
      ? [
          {
            id: tenant.id,
            slug: tenant.slug,
            name: tenant.name,
            status: tenant.status,
            widgetPublicKey: tenant.widgetPublicKey,
            allowedOrigins: tenant.allowedOrigins
          }
        ]
      : []
  });

  if (!resolution.ok) {
    return NextResponse.json(
      {
        error: {
          code: resolution.code,
          message: resolution.message
        }
      },
      { status: resolution.code === "TENANT_NOT_FOUND" ? 404 : 403 }
    );
  }

  return NextResponse.json(toPublicWidgetConfig(tenant));
}
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit widget config route**

```bash
git add src/app/api/widget/config/route.ts
git commit -m "feat: add widget config endpoint"
```

## Task 7: Add Widget Config E2E Smoke Test

**Files:**
- Create: `tests/e2e/widget-config.spec.ts`

- [ ] **Step 1: Create `tests/e2e/widget-config.spec.ts`**

```ts
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
```

- [ ] **Step 2: Run e2e test**

Run:

```bash
npm run test:e2e -- tests/e2e/widget-config.spec.ts
```

Expected: PASS. If it fails because the tenant is missing, run `npm run db:seed` and rerun the e2e test.

- [ ] **Step 3: Commit e2e test**

```bash
git add tests/e2e/widget-config.spec.ts
git commit -m "test: add widget config smoke test"
```

## Task 8: Final Verification

**Files:**
- Modify only if verification finds issues.

- [ ] **Step 1: Run full verification**

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:e2e
```

Expected: all commands pass.

- [ ] **Step 2: Check git status**

```bash
git status --short
```

Expected: no uncommitted changes.

