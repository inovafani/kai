# Kai Project Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the standalone Kai SaaS project foundation in `/Users/inovafani/Documents/Kai` so it can be pushed to GitHub and extended safely.

**Architecture:** The repo root becomes the Next.js application root. The first implementation slice installs the app shell, TypeScript config, testing tools, Prisma/Supabase placeholders, and portable core domain contracts for tenant-selected PMS adapters, booking state, conversation control, and business packs. No production booking behavior or database migration is built in this plan.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, Supabase Postgres, Supabase Auth client, Vitest, Testing Library, Playwright, ESLint.

---

## File Structure

- Create `package.json`: project scripts and dependencies.
- Create `tsconfig.json`: strict TypeScript config.
- Create `next.config.ts`: Next.js config and frame protections.
- Create `.eslintrc.json`: lint config.
- Create `.env.example`: required environment variables without secrets.
- Create `src/app/layout.tsx`: root app layout.
- Create `src/app/page.tsx`: minimal landing/dashboard placeholder.
- Create `src/app/api/health/route.ts`: health check route.
- Create `src/lib/env.ts`: environment access helpers.
- Create `src/core/tenant/types.ts`: tenant and business pack contracts.
- Create `src/core/conversation/types.ts`: conversation/message/control mode contracts.
- Create `src/core/pms/types.ts`: normalized PMS adapter contract.
- Create `src/core/booking/types.ts`: inquiry/booking/payment state contracts.
- Create `src/core/pms/mock-pms-adapter.ts`: deterministic mock adapter.
- Create `src/core/pms/mock-pms-adapter.test.ts`: adapter tests.
- Create `src/core/booking/booking-state.test.ts`: booking state type behavior tests.
- Create `prisma/schema.prisma`: initial Prisma schema skeleton.
- Create `vitest.config.ts`: Vitest config.
- Create `playwright.config.ts`: Playwright config.
- Create `tests/e2e/health.spec.ts`: first smoke e2e test.

## Task 1: Create Project Package and Config

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `.eslintrc.json`
- Create: `.env.example`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "kai",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev"
  },
  "dependencies": {
    "@prisma/client": "^6.9.0",
    "@supabase/ssr": "^0.6.1",
    "@supabase/supabase-js": "^2.50.0",
    "next": "^15.3.3",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "zod": "^3.25.64"
  },
  "devDependencies": {
    "@playwright/test": "^1.52.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.0",
    "@types/node": "^22.15.31",
    "@types/react": "^19.1.6",
    "@types/react-dom": "^19.1.6",
    "eslint": "^9.29.0",
    "eslint-config-next": "^15.3.3",
    "jsdom": "^26.1.0",
    "prisma": "^6.9.0",
    "typescript": "^5.8.3",
    "vitest": "^3.2.3"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/((?!embed).*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY"
          }
        ]
      },
      {
        source: "/embed/:path*",
        headers: [
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
```

- [ ] **Step 4: Create `.eslintrc.json`**

```json
{
  "extends": ["next/core-web-vitals"]
}
```

- [ ] **Step 5: Create `.env.example`**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/kai"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/kai"
NEXT_PUBLIC_SUPABASE_URL="https://example.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="replace-me"
SUPABASE_SERVICE_ROLE_KEY="replace-me"
PMS_CREDENTIAL_ENCRYPTION_KEY="replace-with-32-byte-base64-key"
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`

Expected: `package-lock.json` is created and all dependencies install successfully.

- [ ] **Step 7: Commit package and config**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts .eslintrc.json .env.example
git commit -m "chore: scaffold Kai app config"
```

## Task 2: Add App Shell and Health Route

**Files:**
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/api/health/route.ts`
- Create: `src/app/globals.css`

- [ ] **Step 1: Create `src/app/globals.css`**

```css
:root {
  color-scheme: light;
  --background: #f7f8fb;
  --foreground: #111827;
  --muted: #5f6b7a;
  --border: #d9dee7;
  --accent: #0f766e;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
  background: var(--background);
  color: var(--foreground);
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
}

a {
  color: inherit;
}
```

- [ ] **Step 2: Create `src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kai",
  description: "White-label AI booking orchestrator"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Create `src/app/page.tsx`**

```tsx
const principles = [
  "Tenant-first SaaS boundaries",
  "Deterministic booking tools",
  "Tenant-selected PMS adapters",
  "Portable BluePass migration path"
];

export default function HomePage() {
  return (
    <main style={{ margin: "0 auto", maxWidth: 960, padding: "64px 24px" }}>
      <p style={{ color: "var(--accent)", fontWeight: 700, margin: 0 }}>
        Kai SaaS Core
      </p>
      <h1 style={{ fontSize: 48, lineHeight: 1.05, margin: "12px 0 16px" }}>
        White-label AI booking orchestration.
      </h1>
      <p style={{ color: "var(--muted)", fontSize: 18, lineHeight: 1.6 }}>
        This standalone build proves Kai&apos;s tenant-safe booking loop before
        the core is ported into BluePass.
      </p>
      <section
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          marginTop: 32
        }}
      >
        {principles.map((principle) => (
          <div
            key={principle}
            style={{
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 18
            }}
          >
            {principle}
          </div>
        ))}
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Create `src/app/api/health/route.ts`**

```ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "kai",
    version: "0.1.0"
  });
}
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit app shell**

```bash
git add src/app
git commit -m "feat: add Kai app shell"
```

## Task 3: Add Core Domain Contracts

**Files:**
- Create: `src/core/tenant/types.ts`
- Create: `src/core/conversation/types.ts`
- Create: `src/core/booking/types.ts`
- Create: `src/core/pms/types.ts`

- [ ] **Step 1: Create `src/core/tenant/types.ts`**

```ts
export type TenantStatus = "ACTIVE" | "SUSPENDED" | "DISABLED";

export type BookingMode = "MANUAL_INQUIRY" | "INSTANT_BOOKING";

export type PmsProvider = "MOCK" | "REZDY" | "INSEANQ" | "FAREHARBOR" | "BOKUN" | "NATIVE";

export interface TenantBranding {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  widgetTitle: string;
  welcomeMessage: string;
  brandVoice: string;
}

export interface TenantConfig {
  supportedChannels: Array<"WEB_WIDGET" | "WHATSAPP">;
  enabledFeatures: string[];
  requiredSlots: Record<string, string[]>;
  bookingMode: BookingMode;
  escalationRules: string[];
  responseGuardrails: string[];
}

export interface BusinessPack {
  tenantId: string;
  slug: string;
  status: TenantStatus;
  allowedOrigins: string[];
  branding: TenantBranding;
  config: TenantConfig;
  pmsProvider: PmsProvider;
}
```

- [ ] **Step 2: Create `src/core/conversation/types.ts`**

```ts
export type ConversationControlMode = "AI" | "HUMAN" | "PAUSED";
export type ConversationChannel = "WEB_WIDGET" | "WHATSAPP" | "ADMIN";
export type MessageRole = "TRAVELLER" | "ASSISTANT" | "OPERATOR" | "SYSTEM" | "TOOL";

export interface Conversation {
  id: string;
  tenantId: string;
  channel: ConversationChannel;
  controlMode: ConversationControlMode;
  travellerId: string | null;
  leadId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  tenantId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
}

export function canKaiReply(controlMode: ConversationControlMode) {
  return controlMode === "AI";
}
```

- [ ] **Step 3: Create `src/core/booking/types.ts`**

```ts
export type InquiryStatus = "OPEN" | "OPERATOR_NOTIFIED" | "ACCEPTED" | "DECLINED" | "CLOSED";

export type BookingStatus =
  | "DRAFT"
  | "AVAILABILITY_CHECKED"
  | "PAYMENT_PENDING"
  | "PAYMENT_AUTHORIZED"
  | "EXTERNAL_BOOKING_PENDING"
  | "CONFIRMED"
  | "RECONCILIATION_REQUIRED"
  | "CANCELLED"
  | "FAILED";

export type PaymentStatus = "NOT_REQUIRED" | "PENDING" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "REFUNDED";

export interface BookingState {
  tenantId: string;
  bookingId: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  externalBookingId: string | null;
  externalProvider: string | null;
}

export function isConfirmedBooking(state: BookingState) {
  return state.status === "CONFIRMED" && state.externalBookingId !== null;
}
```

- [ ] **Step 4: Create `src/core/pms/types.ts`**

```ts
import type { PmsProvider } from "@/core/tenant/types";

export interface PmsProduct {
  externalProductId: string;
  title: string;
  description: string;
  bookingMode: "MANUAL_INQUIRY" | "INSTANT_BOOKING";
}

export interface PmsAvailabilityRequest {
  productId: string;
  date: string;
  guests: number;
}

export interface PmsAvailabilityResult {
  productId: string;
  date: string;
  available: boolean;
  remaining: number;
  currency: string;
  unitPriceCents: number;
}

export interface PmsCreateBookingRequest {
  productId: string;
  date: string;
  guests: number;
  travellerName: string;
  travellerEmail: string;
}

export interface PmsCreateBookingResult {
  externalBookingId: string;
  provider: PmsProvider;
  status: "CONFIRMED" | "PENDING" | "FAILED";
}

export interface PmsAdapter {
  provider: PmsProvider;
  listProducts(): Promise<PmsProduct[]>;
  getAvailability(request: PmsAvailabilityRequest): Promise<PmsAvailabilityResult>;
  createBooking(request: PmsCreateBookingRequest): Promise<PmsCreateBookingResult>;
  cancelBooking(externalBookingId: string): Promise<{ cancelled: boolean }>;
  getBooking(externalBookingId: string): Promise<PmsCreateBookingResult | null>;
}
```

- [ ] **Step 5: Commit domain contracts**

```bash
git add src/core
git commit -m "feat: add Kai core domain contracts"
```

## Task 4: Add Mock PMS Adapter with Failing Tests First

**Files:**
- Create: `src/core/pms/mock-pms-adapter.test.ts`
- Create: `src/core/pms/mock-pms-adapter.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"]
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname
    }
  }
});
```

- [ ] **Step 2: Write failing mock PMS tests in `src/core/pms/mock-pms-adapter.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { MockPmsAdapter } from "./mock-pms-adapter";

describe("MockPmsAdapter", () => {
  it("lists deterministic instant-bookable products", async () => {
    const adapter = new MockPmsAdapter();

    const products = await adapter.listProducts();

    expect(products).toEqual([
      {
        externalProductId: "mock-komodo-day-trip",
        title: "Komodo Day Trip",
        description: "A shared day trip with instant booking.",
        bookingMode: "INSTANT_BOOKING"
      },
      {
        externalProductId: "mock-private-charter",
        title: "Private Charter",
        description: "A custom charter that requires operator confirmation.",
        bookingMode: "MANUAL_INQUIRY"
      }
    ]);
  });

  it("returns availability for a known product", async () => {
    const adapter = new MockPmsAdapter();

    const availability = await adapter.getAvailability({
      productId: "mock-komodo-day-trip",
      date: "2026-10-12",
      guests: 2
    });

    expect(availability).toEqual({
      productId: "mock-komodo-day-trip",
      date: "2026-10-12",
      available: true,
      remaining: 8,
      currency: "USD",
      unitPriceCents: 18500
    });
  });

  it("creates a confirmed booking only when capacity is available", async () => {
    const adapter = new MockPmsAdapter();

    const booking = await adapter.createBooking({
      productId: "mock-komodo-day-trip",
      date: "2026-10-12",
      guests: 2,
      travellerName: "Ari Test",
      travellerEmail: "ari@example.com"
    });

    expect(booking).toEqual({
      externalBookingId: "mock-booking-mock-komodo-day-trip-2026-10-12-2",
      provider: "MOCK",
      status: "CONFIRMED"
    });
  });
});
```

- [ ] **Step 3: Run tests to verify RED**

Run: `npm run test -- src/core/pms/mock-pms-adapter.test.ts`

Expected: FAIL because `./mock-pms-adapter` does not exist.

- [ ] **Step 4: Create `src/core/pms/mock-pms-adapter.ts`**

```ts
import type {
  PmsAdapter,
  PmsAvailabilityRequest,
  PmsAvailabilityResult,
  PmsCreateBookingRequest,
  PmsCreateBookingResult,
  PmsProduct
} from "./types";

const PRODUCTS: PmsProduct[] = [
  {
    externalProductId: "mock-komodo-day-trip",
    title: "Komodo Day Trip",
    description: "A shared day trip with instant booking.",
    bookingMode: "INSTANT_BOOKING"
  },
  {
    externalProductId: "mock-private-charter",
    title: "Private Charter",
    description: "A custom charter that requires operator confirmation.",
    bookingMode: "MANUAL_INQUIRY"
  }
];

export class MockPmsAdapter implements PmsAdapter {
  provider = "MOCK" as const;

  async listProducts(): Promise<PmsProduct[]> {
    return PRODUCTS;
  }

  async getAvailability(request: PmsAvailabilityRequest): Promise<PmsAvailabilityResult> {
    const product = PRODUCTS.find((item) => item.externalProductId === request.productId);

    if (!product) {
      return {
        productId: request.productId,
        date: request.date,
        available: false,
        remaining: 0,
        currency: "USD",
        unitPriceCents: 0
      };
    }

    const remaining = product.bookingMode === "INSTANT_BOOKING" ? 10 - request.guests : 0;

    return {
      productId: request.productId,
      date: request.date,
      available: remaining >= 0 && product.bookingMode === "INSTANT_BOOKING",
      remaining: Math.max(remaining, 0),
      currency: "USD",
      unitPriceCents: product.externalProductId === "mock-komodo-day-trip" ? 18500 : 0
    };
  }

  async createBooking(request: PmsCreateBookingRequest): Promise<PmsCreateBookingResult> {
    const availability = await this.getAvailability(request);

    if (!availability.available) {
      return {
        externalBookingId: "",
        provider: this.provider,
        status: "FAILED"
      };
    }

    return {
      externalBookingId: `mock-booking-${request.productId}-${request.date}-${request.guests}`,
      provider: this.provider,
      status: "CONFIRMED"
    };
  }

  async cancelBooking(_externalBookingId: string): Promise<{ cancelled: boolean }> {
    return { cancelled: true };
  }

  async getBooking(externalBookingId: string): Promise<PmsCreateBookingResult | null> {
    if (!externalBookingId.startsWith("mock-booking-")) {
      return null;
    }

    return {
      externalBookingId,
      provider: this.provider,
      status: "CONFIRMED"
    };
  }
}
```

- [ ] **Step 5: Run tests to verify GREEN**

Run: `npm run test -- src/core/pms/mock-pms-adapter.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit mock PMS adapter**

```bash
git add vitest.config.ts src/core/pms
git commit -m "feat: add mock PMS adapter"
```

## Task 5: Add Booking and Conversation Behavior Tests

**Files:**
- Create: `src/core/booking/booking-state.test.ts`
- Create: `src/core/conversation/conversation-control.test.ts`

- [ ] **Step 1: Write `src/core/booking/booking-state.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { isConfirmedBooking } from "./types";

describe("booking state", () => {
  it("requires both CONFIRMED status and an external booking id", () => {
    expect(
      isConfirmedBooking({
        tenantId: "tenant_bluepass",
        bookingId: "booking_1",
        status: "CONFIRMED",
        paymentStatus: "AUTHORIZED",
        externalBookingId: "rezdy_123",
        externalProvider: "REZDY"
      })
    ).toBe(true);

    expect(
      isConfirmedBooking({
        tenantId: "tenant_bluepass",
        bookingId: "booking_2",
        status: "CONFIRMED",
        paymentStatus: "AUTHORIZED",
        externalBookingId: null,
        externalProvider: null
      })
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Write `src/core/conversation/conversation-control.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { canKaiReply } from "./types";

describe("conversation control", () => {
  it("allows Kai replies only in AI mode", () => {
    expect(canKaiReply("AI")).toBe(true);
    expect(canKaiReply("HUMAN")).toBe(false);
    expect(canKaiReply("PAUSED")).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm run test`

Expected: PASS.

- [ ] **Step 4: Commit behavior tests**

```bash
git add src/core/booking/booking-state.test.ts src/core/conversation/conversation-control.test.ts
git commit -m "test: cover booking and conversation primitives"
```

## Task 6: Add Initial Prisma Schema

**Files:**
- Create: `prisma/schema.prisma`

- [ ] **Step 1: Create `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

enum TenantStatus {
  ACTIVE
  SUSPENDED
  DISABLED
}

enum PmsProvider {
  MOCK
  REZDY
  INSEANQ
  FAREHARBOR
  BOKUN
  NATIVE
}

enum ConversationControlMode {
  AI
  HUMAN
  PAUSED
}

model Tenant {
  id        String       @id @default(cuid())
  slug      String       @unique
  name      String
  status    TenantStatus @default(ACTIVE)
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  branding     TenantBranding?
  config       TenantConfig?
  integrations TenantIntegration[]
  conversations Conversation[]
}

model TenantBranding {
  id             String   @id @default(cuid())
  tenantId       String   @unique
  logoUrl        String?
  primaryColor   String
  widgetTitle    String
  welcomeMessage String
  brandVoice     String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
}

model TenantConfig {
  id                 String      @id @default(cuid())
  tenantId           String      @unique
  supportedChannels  String[]
  enabledFeatures    String[]
  requiredSlots      Json
  bookingMode        String
  escalationRules    String[]
  responseGuardrails String[]
  createdAt          DateTime    @default(now())
  updatedAt          DateTime    @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
}

model TenantIntegration {
  id                   String      @id @default(cuid())
  tenantId             String
  provider             PmsProvider
  encryptedCredentials String
  status               String
  createdAt            DateTime    @default(now())
  updatedAt            DateTime    @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, provider])
}

model Conversation {
  id          String                  @id @default(cuid())
  tenantId    String
  controlMode ConversationControlMode @default(AI)
  channel     String
  travellerId String?
  leadId      String?
  createdAt   DateTime                @default(now())
  updatedAt   DateTime                @updatedAt

  tenant   Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  messages Message[]
}

model Message {
  id             String   @id @default(cuid())
  tenantId       String
  conversationId String
  role           String
  content        String
  createdAt      DateTime @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([tenantId, conversationId, createdAt])
}
```

- [ ] **Step 2: Run Prisma validation**

Run: `npx prisma validate`

Expected: Prisma schema validates successfully.

- [ ] **Step 3: Commit Prisma schema**

```bash
git add prisma/schema.prisma
git commit -m "feat: add initial Prisma schema"
```

## Task 7: Add E2E Smoke Test

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/health.spec.ts`

- [ ] **Step 1: Create `playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
```

- [ ] **Step 2: Create `tests/e2e/health.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

test("home page and health route are reachable", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /white-label ai booking orchestration/i })).toBeVisible();

  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  await expect(response).toHaveJSON({
    ok: true,
    service: "kai",
    version: "0.1.0"
  });
});
```

- [ ] **Step 3: Run Playwright install if browsers are missing**

Run: `npx playwright install chromium`

Expected: Chromium browser is installed for local e2e tests.

- [ ] **Step 4: Run e2e test**

Run: `npm run test:e2e`

Expected: PASS.

- [ ] **Step 5: Commit e2e smoke test**

```bash
git add playwright.config.ts tests/e2e/health.spec.ts
git commit -m "test: add app smoke e2e"
```

## Task 8: Final Verification

**Files:**
- Modify only if verification finds issues.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Expected: all commands pass.

- [ ] **Step 2: Check git status**

Run: `git status --short`

Expected: no uncommitted changes.

