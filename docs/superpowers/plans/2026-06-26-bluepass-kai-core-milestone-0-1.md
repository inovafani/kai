# BluePass Kai Core Milestone 0-1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first explicit Kai Core business-pack layer so Boattime remains an operator-direct tenant and BluePass can be introduced as a marketplace pack without hardcoding BluePass behavior into the core.

**Architecture:** Keep the current tenant resolver, widget APIs, PMS registry, and Boattime booking flow intact. Add small focused business-pack contracts and a resolver that turns tenant configuration into allowed tools, payment policy, and marketplace/operator behavior. Seed BluePass as a disabled-for-booking marketplace tenant first, proving pack resolution and public config without building BluePass inquiry tools yet.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, Vitest, Playwright, existing tenant/widget/PMS services.

---

## File Structure

- Create `src/core/business-pack/types.ts`: shared business-pack type definitions, tool names, payment policy, and helper predicates.
- Create `src/core/business-pack/registry.ts`: pure registry that maps a tenant slug/config to a business pack descriptor.
- Create `src/core/business-pack/registry.test.ts`: unit tests for Boattime operator-direct vs BluePass marketplace behavior.
- Modify `src/core/tenant/types.ts`: optionally re-export business-pack-facing types only if needed by existing tenant contracts.
- Modify `src/server/widget/widget-config.ts`: include a public `businessPack` summary in widget config so native/embedded shells can adapt safely.
- Modify `src/server/widget/widget-config.test.ts`: verify public widget config exposes only non-secret business-pack fields.
- Modify `scripts/seed-first-tenant.mjs`: add the `bluepass` tenant seed with `bluepass_marketplace` feature flags and no booking writes.
- Create `src/server/business-pack/resolve-tenant-business-pack.ts`: converts a Prisma tenant record into the business-pack descriptor used by API routes.
- Create `src/server/business-pack/resolve-tenant-business-pack.test.ts`: verifies Prisma-like tenant records resolve without leaking credentials or full config.
- Modify `src/app/api/widget/config/route.ts`: return business pack summary through existing presenter only; no behavior change to message handling.
- Modify `tests/e2e/widget-config.spec.ts`: add BluePass config smoke test.

Milestone 0-1 deliberately does not implement BluePass inquiry tools yet. It creates the pack boundary that Milestone 2 will use.

## Task 1: Add Pure Business Pack Registry

**Files:**
- Create: `src/core/business-pack/types.ts`
- Create: `src/core/business-pack/registry.ts`
- Create: `src/core/business-pack/registry.test.ts`

- [ ] **Step 1: Write the failing registry tests**

Create `src/core/business-pack/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveBusinessPack } from "./registry";

describe("resolveBusinessPack", () => {
  it("resolves Boattime as an operator-direct pack with instant booking tools", () => {
    const pack = resolveBusinessPack({
      tenantId: "tenant_boattime",
      slug: "boattime",
      name: "Boattime Yacht Charters",
      enabledFeatures: ["widget_config", "mock_pms", "boattime_local_demo"],
      bookingMode: "MANUAL_INQUIRY",
      bookingWriteEnabled: true,
      pmsProvider: "REZDY",
    });

    expect(pack).toEqual({
      tenantId: "tenant_boattime",
      slug: "boattime",
      displayName: "Boattime Yacht Charters",
      kind: "operator_direct",
      tools: [
        "product_search",
        "check_availability",
        "create_manual_inquiry",
        "create_instant_booking",
        "capture_payment",
        "handoff_to_operator",
      ],
      paymentPolicy: "instant_payment_allowed",
      truthPolicy: {
        availabilitySource: "pms_live",
        priceSource: "pms_live",
        bookingConfirmationSource: "pms_write_back",
      },
    });
  });

  it("resolves BluePass as a marketplace pack with inquiry and referral tools only", () => {
    const pack = resolveBusinessPack({
      tenantId: "tenant_bluepass",
      slug: "bluepass",
      name: "BluePass",
      enabledFeatures: [
        "widget_config",
        "bluepass_marketplace",
        "referral_attribution",
        "operator_whatsapp_dispatch",
      ],
      bookingMode: "MANUAL_INQUIRY",
      bookingWriteEnabled: false,
      pmsProvider: "NATIVE",
    });

    expect(pack.kind).toBe("bluepass_marketplace");
    expect(pack.tools).toEqual([
      "search_bluepass_yachts",
      "create_bluepass_inquiry",
      "sync_referral_ledger_estimate",
      "dispatch_operator_whatsapp",
      "get_bluepass_inquiry_status",
      "handoff_to_operator",
    ]);
    expect(pack.paymentPolicy).toBe("operator_acceptance_required");
    expect(pack.tools).not.toContain("create_instant_booking");
    expect(pack.tools).not.toContain("capture_payment");
  });

  it("does not grant BluePass marketplace tools to a generic tenant", () => {
    const pack = resolveBusinessPack({
      tenantId: "tenant_demo",
      slug: "kai-demo",
      name: "Kai Demo",
      enabledFeatures: ["widget_config", "mock_pms"],
      bookingMode: "MANUAL_INQUIRY",
      bookingWriteEnabled: false,
      pmsProvider: "MOCK",
    });

    expect(pack.kind).toBe("operator_direct");
    expect(pack.tools).toEqual([
      "product_search",
      "check_availability",
      "create_manual_inquiry",
      "handoff_to_operator",
    ]);
    expect(pack.tools).not.toContain("search_bluepass_yachts");
    expect(pack.paymentPolicy).toBe("no_payment_in_kai");
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm run test -- src/core/business-pack/registry.test.ts
```

Expected: FAIL because `src/core/business-pack/registry.ts` does not exist.

- [ ] **Step 3: Add business-pack types**

Create `src/core/business-pack/types.ts`:

```ts
import type { BookingMode, PmsProvider } from "@/core/tenant/types";

export type BusinessPackKind = "operator_direct" | "bluepass_marketplace";

export type KaiToolName =
  | "product_search"
  | "check_availability"
  | "create_manual_inquiry"
  | "create_instant_booking"
  | "capture_payment"
  | "handoff_to_operator"
  | "search_bluepass_yachts"
  | "create_bluepass_inquiry"
  | "sync_referral_ledger_estimate"
  | "dispatch_operator_whatsapp"
  | "get_bluepass_inquiry_status";

export type PaymentPolicy =
  | "no_payment_in_kai"
  | "instant_payment_allowed"
  | "operator_acceptance_required";

export type TruthPolicy = {
  availabilitySource: "preview_catalog" | "pms_live" | "operator_confirmed";
  priceSource: "preview_catalog" | "pms_live" | "operator_quote";
  bookingConfirmationSource: "none" | "pms_write_back" | "operator_admin";
};

export type BusinessPackResolutionInput = {
  tenantId: string;
  slug: string;
  name: string;
  enabledFeatures: string[];
  bookingMode: BookingMode | string;
  bookingWriteEnabled: boolean;
  pmsProvider: PmsProvider;
};

export type BusinessPackDescriptor = {
  tenantId: string;
  slug: string;
  displayName: string;
  kind: BusinessPackKind;
  tools: KaiToolName[];
  paymentPolicy: PaymentPolicy;
  truthPolicy: TruthPolicy;
};

export function hasTool(
  pack: Pick<BusinessPackDescriptor, "tools">,
  tool: KaiToolName,
) {
  return pack.tools.includes(tool);
}
```

- [ ] **Step 4: Add the pure registry implementation**

Create `src/core/business-pack/registry.ts`:

```ts
import type {
  BusinessPackDescriptor,
  BusinessPackResolutionInput,
  KaiToolName,
  PaymentPolicy,
  TruthPolicy,
} from "./types";

const operatorInquiryTools: KaiToolName[] = [
  "product_search",
  "check_availability",
  "create_manual_inquiry",
  "handoff_to_operator",
];

const operatorInstantTools: KaiToolName[] = [
  ...operatorInquiryTools,
  "create_instant_booking",
  "capture_payment",
];

const bluepassMarketplaceTools: KaiToolName[] = [
  "search_bluepass_yachts",
  "create_bluepass_inquiry",
  "sync_referral_ledger_estimate",
  "dispatch_operator_whatsapp",
  "get_bluepass_inquiry_status",
  "handoff_to_operator",
];

export function resolveBusinessPack(
  input: BusinessPackResolutionInput,
): BusinessPackDescriptor {
  if (isBluePassMarketplace(input)) {
    return {
      tenantId: input.tenantId,
      slug: input.slug,
      displayName: input.name,
      kind: "bluepass_marketplace",
      tools: bluepassMarketplaceTools,
      paymentPolicy: "operator_acceptance_required",
      truthPolicy: {
        availabilitySource: "preview_catalog",
        priceSource: "preview_catalog",
        bookingConfirmationSource: "operator_admin",
      },
    };
  }

  const instantBookingAllowed =
    input.bookingWriteEnabled && input.bookingMode === "AUTO_BOOKING";
  const boattimeRezdyWrite =
    input.slug === "boattime" &&
    input.bookingWriteEnabled &&
    input.pmsProvider === "REZDY";
  const tools = instantBookingAllowed || boattimeRezdyWrite
    ? operatorInstantTools
    : operatorInquiryTools;

  return {
    tenantId: input.tenantId,
    slug: input.slug,
    displayName: input.name,
    kind: "operator_direct",
    tools,
    paymentPolicy: resolveOperatorPaymentPolicy(tools),
    truthPolicy: resolveOperatorTruthPolicy(input, tools),
  };
}

function isBluePassMarketplace(input: BusinessPackResolutionInput) {
  return (
    input.slug === "bluepass" ||
    input.enabledFeatures.includes("bluepass_marketplace")
  );
}

function resolveOperatorPaymentPolicy(tools: KaiToolName[]): PaymentPolicy {
  return tools.includes("capture_payment")
    ? "instant_payment_allowed"
    : "no_payment_in_kai";
}

function resolveOperatorTruthPolicy(
  input: BusinessPackResolutionInput,
  tools: KaiToolName[],
): TruthPolicy {
  if (tools.includes("create_instant_booking") && input.pmsProvider !== "MOCK") {
    return {
      availabilitySource: "pms_live",
      priceSource: "pms_live",
      bookingConfirmationSource: "pms_write_back",
    };
  }

  return {
    availabilitySource: "preview_catalog",
    priceSource: "preview_catalog",
    bookingConfirmationSource: "none",
  };
}
```

- [ ] **Step 5: Run test to verify GREEN**

Run:

```bash
npm run test -- src/core/business-pack/registry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add src/core/business-pack/types.ts src/core/business-pack/registry.ts src/core/business-pack/registry.test.ts
git commit -m "feat: add Kai business pack registry"
```

## Task 2: Add Server Resolver for Tenant Business Packs

**Files:**
- Create: `src/server/business-pack/resolve-tenant-business-pack.ts`
- Create: `src/server/business-pack/resolve-tenant-business-pack.test.ts`

- [ ] **Step 1: Write failing server resolver tests**

Create `src/server/business-pack/resolve-tenant-business-pack.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveTenantBusinessPack } from "./resolve-tenant-business-pack";

const baseTenant = {
  id: "tenant_1",
  slug: "kai-demo",
  name: "Kai Demo",
  config: {
    enabledFeatures: ["widget_config"],
    bookingMode: "MANUAL_INQUIRY",
    bookingWriteEnabled: false,
    pmsProvider: "MOCK",
  },
};

describe("resolveTenantBusinessPack", () => {
  it("resolves a Prisma-like tenant record", () => {
    expect(resolveTenantBusinessPack(baseTenant)).toEqual(
      expect.objectContaining({
        tenantId: "tenant_1",
        slug: "kai-demo",
        kind: "operator_direct",
        paymentPolicy: "no_payment_in_kai",
      }),
    );
  });

  it("defaults missing config safely", () => {
    expect(
      resolveTenantBusinessPack({
        id: "tenant_no_config",
        slug: "empty",
        name: "Empty Tenant",
        config: null,
      }),
    ).toEqual(
      expect.objectContaining({
        tenantId: "tenant_no_config",
        tools: [
          "product_search",
          "check_availability",
          "create_manual_inquiry",
          "handoff_to_operator",
        ],
        paymentPolicy: "no_payment_in_kai",
      }),
    );
  });

  it("resolves BluePass from enabled feature", () => {
    const pack = resolveTenantBusinessPack({
      ...baseTenant,
      id: "tenant_bluepass",
      slug: "bluepass",
      name: "BluePass",
      config: {
        enabledFeatures: ["widget_config", "bluepass_marketplace"],
        bookingMode: "MANUAL_INQUIRY",
        bookingWriteEnabled: false,
        pmsProvider: "NATIVE",
      },
    });

    expect(pack.kind).toBe("bluepass_marketplace");
    expect(pack.paymentPolicy).toBe("operator_acceptance_required");
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm run test -- src/server/business-pack/resolve-tenant-business-pack.test.ts
```

Expected: FAIL because `resolve-tenant-business-pack.ts` does not exist.

- [ ] **Step 3: Add resolver implementation**

Create `src/server/business-pack/resolve-tenant-business-pack.ts`:

```ts
import { resolveBusinessPack } from "@/core/business-pack/registry";
import type { BusinessPackDescriptor } from "@/core/business-pack/types";
import type { BookingMode, PmsProvider } from "@/core/tenant/types";

type TenantBusinessPackInput = {
  id: string;
  slug: string;
  name: string;
  config: {
    enabledFeatures: string[];
    bookingMode: string;
    bookingWriteEnabled?: boolean;
    pmsProvider: PmsProvider;
  } | null;
};

export function resolveTenantBusinessPack(
  tenant: TenantBusinessPackInput,
): BusinessPackDescriptor {
  return resolveBusinessPack({
    tenantId: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    enabledFeatures: tenant.config?.enabledFeatures ?? [],
    bookingMode: (tenant.config?.bookingMode ?? "MANUAL_INQUIRY") as BookingMode,
    bookingWriteEnabled: tenant.config?.bookingWriteEnabled ?? false,
    pmsProvider: tenant.config?.pmsProvider ?? "MOCK",
  });
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
npm run test -- src/server/business-pack/resolve-tenant-business-pack.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/server/business-pack/resolve-tenant-business-pack.ts src/server/business-pack/resolve-tenant-business-pack.test.ts
git commit -m "feat: resolve tenant business packs"
```

## Task 3: Expose Safe Business Pack Summary in Widget Config

**Files:**
- Modify: `src/server/widget/widget-config.ts`
- Modify: `src/server/widget/widget-config.test.ts`

- [ ] **Step 1: Add failing widget config test**

Append this test to `src/server/widget/widget-config.test.ts`:

```ts
it("includes a safe public business pack summary", () => {
  const config = toPublicWidgetConfig({
    id: "tenant_bluepass",
    slug: "bluepass",
    name: "BluePass",
    defaultLocale: "en",
    branding: {
      logoUrl: null,
      primaryColor: "#0f766e",
      widgetTitle: "Kai",
      welcomeMessage: "Plan your ocean trip with Kai.",
      brandVoice: "Internal voice rules must not leak.",
    },
    config: {
      supportedChannels: ["WEB_WIDGET", "WHATSAPP"],
      enabledFeatures: ["widget_config", "bluepass_marketplace"],
      bookingMode: "MANUAL_INQUIRY",
      bookingWriteEnabled: false,
      pmsProvider: "NATIVE",
    },
  });

  expect(config.businessPack).toEqual({
    kind: "bluepass_marketplace",
    paymentPolicy: "operator_acceptance_required",
    tools: [
      "search_bluepass_yachts",
      "create_bluepass_inquiry",
      "sync_referral_ledger_estimate",
      "dispatch_operator_whatsapp",
      "get_bluepass_inquiry_status",
      "handoff_to_operator",
    ],
    truthPolicy: {
      availabilitySource: "preview_catalog",
      priceSource: "preview_catalog",
      bookingConfirmationSource: "operator_admin",
    },
  });
  expect(JSON.stringify(config)).not.toContain("Internal voice rules");
});
```

If the existing test object in this file has a `config` shape without `bookingWriteEnabled`, update that fixture to include `bookingWriteEnabled: false`.

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm run test -- src/server/widget/widget-config.test.ts
```

Expected: FAIL because `businessPack` is not present.

- [ ] **Step 3: Update widget config presenter**

Replace `src/server/widget/widget-config.ts` with:

```ts
import { resolveBusinessPack } from "@/core/business-pack/registry";
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
    bookingWriteEnabled?: boolean;
    pmsProvider: PmsProvider;
  } | null;
}

export function toPublicWidgetConfig(tenant: WidgetTenantInput) {
  const businessPack = resolveBusinessPack({
    tenantId: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    enabledFeatures: tenant.config?.enabledFeatures ?? [],
    bookingMode: (tenant.config?.bookingMode ?? "MANUAL_INQUIRY") as BookingMode,
    bookingWriteEnabled: tenant.config?.bookingWriteEnabled ?? false,
    pmsProvider: tenant.config?.pmsProvider ?? "MOCK",
  });

  return {
    tenant: {
      slug: tenant.slug,
      name: tenant.name,
      defaultLocale: tenant.defaultLocale,
    },
    branding: {
      logoUrl: tenant.branding?.logoUrl ?? null,
      primaryColor: tenant.branding?.primaryColor ?? "#0f766e",
      widgetTitle: tenant.branding?.widgetTitle ?? tenant.name,
      welcomeMessage:
        tenant.branding?.welcomeMessage ?? "Hi, I am Kai. How can I help?",
    },
    capabilities: {
      supportedChannels: tenant.config?.supportedChannels ?? ["WEB_WIDGET"],
      enabledFeatures: tenant.config?.enabledFeatures ?? [],
      bookingMode: (tenant.config?.bookingMode ?? "MANUAL_INQUIRY") as BookingMode,
      pmsProvider: tenant.config?.pmsProvider ?? "MOCK",
    },
    businessPack: {
      kind: businessPack.kind,
      tools: businessPack.tools,
      paymentPolicy: businessPack.paymentPolicy,
      truthPolicy: businessPack.truthPolicy,
    },
  };
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
npm run test -- src/server/widget/widget-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src/server/widget/widget-config.ts src/server/widget/widget-config.test.ts
git commit -m "feat: expose widget business pack summary"
```

## Task 4: Seed BluePass Marketplace Tenant

**Files:**
- Modify: `scripts/seed-first-tenant.mjs`
- Modify: `tests/e2e/widget-config.spec.ts`

- [ ] **Step 1: Add failing BluePass widget config e2e test**

Append this test to `tests/e2e/widget-config.spec.ts`:

```ts
test("widget config returns BluePass marketplace pack for BluePass tenant", async ({ request }) => {
  const response = await request.get("/api/widget/config?key=pk_test_bluepass", {
    headers: {
      origin: "http://localhost:3107",
    },
  });

  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    tenant: {
      slug: "bluepass",
      name: "BluePass",
    },
    businessPack: {
      kind: "bluepass_marketplace",
      paymentPolicy: "operator_acceptance_required",
      truthPolicy: {
        availabilitySource: "preview_catalog",
        priceSource: "preview_catalog",
        bookingConfirmationSource: "operator_admin",
      },
    },
  });
});
```

- [ ] **Step 2: Run e2e to verify RED if BluePass is not seeded**

Run:

```bash
npm run test:e2e -- tests/e2e/widget-config.spec.ts --grep "BluePass marketplace"
```

Expected: FAIL with a 404 `TENANT_NOT_FOUND` if the local database does not yet have `pk_test_bluepass`.

- [ ] **Step 3: Add BluePass tenant to seed script**

In `scripts/seed-first-tenant.mjs`, add this object to the `tenants` array after the Boattime tenant:

```js
  {
    slug: "bluepass",
    name: "BluePass",
    widgetPublicKey: "pk_test_bluepass",
    allowedOrigins: ["http://localhost:3107", "http://127.0.0.1:3107"],
    defaultLocale: "en",
    branding: {
      logoUrl: null,
      primaryColor: "#0f766e",
      widgetTitle: "Kai",
      welcomeMessage: "Tell Kai your dates, crew, and ocean-trip style.",
      brandVoice:
        "Cinematic, trustworthy, conservation-first, practical, and honest about preview catalog versus operator-confirmed booking truth."
    },
    config: {
      supportedChannels: ["WEB_WIDGET", "WHATSAPP"],
      enabledFeatures: [
        "widget_config",
        "bluepass_marketplace",
        "referral_attribution",
        "operator_whatsapp_dispatch",
        "inquiry_status"
      ],
      requiredSlots,
      bookingMode: "MANUAL_INQUIRY",
      bookingWriteEnabled: false,
      pmsProvider: "NATIVE",
      publicProductCatalog: [],
      escalationRules: [
        "human_requested",
        "operator_acceptance_required",
        "custom_quote",
        "payment_readiness_required"
      ],
      responseGuardrails: [
        ...responseGuardrails,
        "BluePass catalog matches are preview signals until an operator confirms.",
        "Do not show payment for BluePass before operator acceptance and booking readiness.",
        "Mention the 5% conservation allocation only as BluePass policy, not as proof a transfer has completed."
      ]
    }
  }
```

Make sure the previous object in the array has a trailing comma.

- [ ] **Step 4: Run seed**

Run:

```bash
npm run db:seed
```

Expected output includes:

```text
Seeded tenant bluepass with widget key pk_test_bluepass
```

- [ ] **Step 5: Run BluePass widget config e2e**

Run:

```bash
npm run test:e2e -- tests/e2e/widget-config.spec.ts --grep "BluePass marketplace"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add scripts/seed-first-tenant.mjs tests/e2e/widget-config.spec.ts
git commit -m "feat: seed BluePass marketplace tenant"
```

## Task 5: Gate Widget Message Route with Business Pack Capabilities

**Files:**
- Create: `src/app/api/widget/messages/business-pack-gate.test.ts`
- Create: `src/app/api/widget/messages/business-pack-gate.ts`
- Modify: `src/app/api/widget/messages/route.ts`

- [ ] **Step 1: Write failing capability gate tests**

Create `src/app/api/widget/messages/business-pack-gate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shouldUseGenericBookingFlow } from "./business-pack-gate";

describe("shouldUseGenericBookingFlow", () => {
  it("allows operator-direct packs to use the current booking flow", () => {
    expect(
      shouldUseGenericBookingFlow({
        kind: "operator_direct",
        tools: ["product_search", "check_availability", "create_manual_inquiry"],
      }),
    ).toBe(true);
  });

  it("blocks BluePass marketplace packs from the current operator booking flow", () => {
    expect(
      shouldUseGenericBookingFlow({
        kind: "bluepass_marketplace",
        tools: ["search_bluepass_yachts", "create_bluepass_inquiry"],
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm run test -- src/app/api/widget/messages/business-pack-gate.test.ts
```

Expected: FAIL because `business-pack-gate.ts` does not exist.

- [ ] **Step 3: Add capability gate**

Create `src/app/api/widget/messages/business-pack-gate.ts`:

```ts
import type { BusinessPackKind, KaiToolName } from "@/core/business-pack/types";

type MessagePackGateInput = {
  kind: BusinessPackKind;
  tools: KaiToolName[];
};

export function shouldUseGenericBookingFlow(input: MessagePackGateInput) {
  return input.kind === "operator_direct";
}
```

- [ ] **Step 4: Run gate test to verify GREEN**

Run:

```bash
npm run test -- src/app/api/widget/messages/business-pack-gate.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire the gate into `route.ts`**

Modify `src/app/api/widget/messages/route.ts`:

Add imports near the existing imports:

```ts
import { resolveTenantBusinessPack } from "@/server/business-pack/resolve-tenant-business-pack";
import { shouldUseGenericBookingFlow } from "./business-pack-gate";
```

After `findTenantConversation` confirms the conversation exists and before loading booking state, add:

```ts
  const businessPack = resolveTenantBusinessPack(resolved.tenant);

  if (!shouldUseGenericBookingFlow(businessPack)) {
    const message = await createTravellerMessage({
      tenantId: resolved.tenant.id,
      conversationId: conversation.id,
      content,
    });
    const assistantMessage = await createAssistantMessage({
      tenantId: resolved.tenant.id,
      conversationId: conversation.id,
      content:
        "BluePass marketplace Kai is being connected to the BluePass inquiry system. I can help with BluePass trip discovery next, but I will not use the operator-direct booking flow for this tenant.",
    });

    return NextResponse.json({
      message: {
        id: message.id,
        tenantSlug: resolved.tenant.slug,
        conversationId: message.conversationId,
        role: message.role,
        content: message.content,
      },
      assistantMessage: {
        id: assistantMessage.id,
        tenantSlug: resolved.tenant.slug,
        conversationId: assistantMessage.conversationId,
        role: assistantMessage.role,
        content: assistantMessage.content,
      },
      manualInquiry: null,
      paymentRequest: null,
      contactRequest: null,
      businessPack: {
        kind: businessPack.kind,
        paymentPolicy: businessPack.paymentPolicy,
      },
    });
  }
```

This temporary response is intentional for Milestone 1. It prevents BluePass from accidentally using Boattime/operator-direct booking while Milestone 2 builds BluePass-specific tools.

- [ ] **Step 6: Run typecheck and targeted tests**

Run:

```bash
npm run typecheck
npm run test -- src/app/api/widget/messages/business-pack-gate.test.ts src/server/business-pack/resolve-tenant-business-pack.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

Run:

```bash
git add src/app/api/widget/messages/route.ts src/app/api/widget/messages/business-pack-gate.ts src/app/api/widget/messages/business-pack-gate.test.ts
git commit -m "feat: gate widget messages by business pack"
```

## Task 6: Milestone 0-1 Verification

**Files:**
- No file edits expected unless verification finds a defect.

- [ ] **Step 1: Run targeted business-pack tests**

Run:

```bash
npm run test -- src/core/business-pack/registry.test.ts src/server/business-pack/resolve-tenant-business-pack.test.ts src/server/widget/widget-config.test.ts src/app/api/widget/messages/business-pack-gate.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 2: Run full unit test suite**

Run:

```bash
npm test
```

Expected: all Vitest tests pass.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: TypeScript exits with code 0.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: Prisma generate and Next build pass.

- [ ] **Step 5: Run widget config e2e**

Run:

```bash
npm run test:e2e -- tests/e2e/widget-config.spec.ts
```

Expected: widget config e2e tests pass, including the new BluePass marketplace config smoke.

- [ ] **Step 6: Check git status**

Run:

```bash
git status --short --branch
```

Expected: branch is clean and ahead by the commits from this plan.

## Plan Self-Review

Spec coverage:

- BluePass is introduced as a marketplace pack, not as generic operator behavior: covered by Tasks 1, 2, 4, and 5.
- Boattime remains operator-direct reference tenant: covered by Task 1 tests and Task 5 gate preserving the current flow for operator packs.
- BluePass payment is blocked before operator acceptance/readiness: covered by the `operator_acceptance_required` payment policy in Tasks 1 and 3.
- BluePass-specific inquiry/referral/WhatsApp tools are named but not implemented: covered as explicit Milestone 1 boundary; implementation moves to Milestone 2.
- Existing BluePass app remains source of truth: preserved by only adding contracts in the `kai` repo.

Placeholder scan:

- The word `placeholder` appears only as the existing BluePass ledger concept `operator payout placeholder`, not as an unfinished plan item.
- There are no `TBD`, `TODO`, or vague implementation steps.

Type consistency:

- `BusinessPackKind`, `KaiToolName`, `PaymentPolicy`, and `TruthPolicy` are defined in Task 1 and reused consistently in later tasks.
- The server resolver accepts Prisma-like tenant records with the existing `config.bookingWriteEnabled` and `config.pmsProvider` fields.
- Widget config uses the same `resolveBusinessPack` function as server-side message gating.
