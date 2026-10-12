import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createNativeTenant, NATIVE_GO_LIVE_FEATURES } from "./create-native-tenant";

// Needs the native-booking migration applied. Every tenant made here is deleted afterwards.
const run = randomUUID();
const name = `Native Tenant Test ${run}`;
const operatorA = `op_${run}_a`;
const operatorB = `op_${run}_b`;

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { externalOperatorId: { in: [operatorA, operatorB] } } });
});

describe("createNativeTenant", () => {
  it("creates a native tenant, then returns the same one for the same operator", async () => {
    const first = await createNativeTenant({ externalOperatorId: operatorA, name, adminWhatsAppPhone: "+1 246 555 0134" });
    expect(first.created).toBe(true);
    expect(first.enabledFeatures).toEqual([]);

    const second = await createNativeTenant({ externalOperatorId: operatorA, name });
    expect(second.created).toBe(false);
    expect(second.slug).toBe(first.slug);
    expect(second.widgetPublicKey).toBe(first.widgetPublicKey);

    const stored = await prisma.tenant.findUnique({ where: { slug: first.slug }, include: { config: true } });
    expect(stored?.config?.pmsProvider).toBe("NATIVE");
    expect(stored?.config?.adminWhatsAppPhone).toBe("12465550134");
    expect(stored?.externalOperatorId).toBe(operatorA);
  });

  it("turns the traveller-facing features on at go-live, and never off again", async () => {
    const live = await createNativeTenant({ externalOperatorId: operatorA, name, goLive: true });
    expect(live.enabledFeatures).toEqual(expect.arrayContaining(NATIVE_GO_LIVE_FEATURES));

    const again = await createNativeTenant({ externalOperatorId: operatorA, name, goLive: false });
    expect(again.enabledFeatures).toEqual(expect.arrayContaining(NATIVE_GO_LIVE_FEATURES));
  });

  it("gives a second operator with the same name its own tenant", async () => {
    const first = await createNativeTenant({ externalOperatorId: operatorA, name });
    const other = await createNativeTenant({ externalOperatorId: operatorB, name });
    expect(other.created).toBe(true);
    expect(other.slug).not.toBe(first.slug);
  });
});
