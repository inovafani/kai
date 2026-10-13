import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/widget/messages/route";
import { listAuRecommendationCandidates } from "./au-operator-recommendation";

// Throwaway tenants in the shared database, deleted afterwards. The slug ends in a UUID, which the
// admin overview treats as a test fixture, so none of this shows up as a real operator.
const PREFIX = "platform-kind-";
const originalEnv = { ...process.env };

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { startsWith: PREFIX } } });
});

async function makeTenant(input: { name: string; kind: "OPERATOR" | "PLATFORM"; enabledFeatures: string[] }) {
  return prisma.tenant.create({
    data: {
      slug: `${PREFIX}${randomUUID()}`,
      name: input.name,
      kind: input.kind,
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://bluepass.co"],
      status: "ACTIVE",
      config: {
        create: {
          supportedChannels: ["WEB_WIDGET"],
          enabledFeatures: input.enabledFeatures,
          requiredSlots: {},
          bookingMode: "AUTO_BOOKING",
          bookingWriteEnabled: false,
          pmsProvider: "MOCK",
          escalationRules: [],
          responseGuardrails: []
        }
      }
    }
  });
}

describe("tenant kind", () => {
  it("never lists BluePass's own chat as an operator to recommend, even if it carries the old flag", async () => {
    const operator = await makeTenant({ name: "Kind Test Reef Co", kind: "OPERATOR", enabledFeatures: ["whatsapp_generic_eligible"] });
    const platform = await makeTenant({ name: "Kind Test BluePass Chat", kind: "PLATFORM", enabledFeatures: ["whatsapp_generic_eligible"] });

    const candidates = await listAuRecommendationCandidates();
    expect(candidates.map((candidate) => candidate.slug)).toContain(operator.slug);
    expect(candidates.map((candidate) => candidate.slug)).not.toContain(platform.slug);
  }, 60_000);

  it("lets BluePass's chat open with a list of operators, and keeps itself out of that list", async () => {
    delete process.env.ENABLE_LLM;
    const operator = await makeTenant({ name: "Kind Test Snorkel Co", kind: "OPERATOR", enabledFeatures: ["whatsapp_generic_eligible"] });
    // No eligibility flag at all: being PLATFORM is what starts the recommendation.
    const platform = await makeTenant({ name: "Kind Test BluePass Australia", kind: "PLATFORM", enabledFeatures: [] });
    const conversation = await prisma.conversation.create({ data: { tenantId: platform.id, channel: "WEB_WIDGET", controlMode: "AI" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not stubbed", { status: 404 })));

    const response = await POST(
      new NextRequest("http://localhost/api/widget/messages", {
        method: "POST",
        headers: { origin: "https://bluepass.co", "content-type": "application/json" },
        body: JSON.stringify({ key: platform.widgetPublicKey, conversationId: conversation.id, content: "I want to go snorkelling in Australia" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assistantMessage.content).toContain("Kind Test Snorkel Co");
    expect(body.assistantMessage.content).not.toContain("Kind Test BluePass Australia");
  }, 90_000);

  it("moves the traveller into the operator's own conversation when only one operator fits", async () => {
    delete process.env.ENABLE_LLM;
    // Only this operator is eligible in this test (the real ones are hidden by the same filter the
    // other router tests use), so the recommendation skips the list and goes straight to it.
    const operator = await makeTenant({ name: "Kind Test Solo Operator", kind: "OPERATOR", enabledFeatures: ["whatsapp_generic_eligible"] });
    const platform = await makeTenant({ name: "Kind Test BluePass Solo", kind: "PLATFORM", enabledFeatures: [] });
    const conversation = await prisma.conversation.create({ data: { tenantId: platform.id, channel: "WEB_WIDGET", controlMode: "AI" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not stubbed", { status: 404 })));

    const realFindMany = prisma.tenant.findMany.bind(prisma.tenant);
    const spy = vi.spyOn(prisma.tenant, "findMany").mockImplementation((async (args: any) => {
      const rows = await realFindMany(args);
      return args?.where?.config?.enabledFeatures?.has === "whatsapp_generic_eligible" ? (rows as any[]).filter((row) => row.id === operator.id) : rows;
    }) as any);

    try {
      const response = await POST(
        new NextRequest("http://localhost/api/widget/messages", {
          method: "POST",
          headers: { origin: "https://bluepass.co", "content-type": "application/json" },
          body: JSON.stringify({ key: platform.widgetPublicKey, conversationId: conversation.id, content: "I want to go snorkelling in Australia" })
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.assistantMessage.content).toContain("Connecting you with Kind Test Solo Operator");
      // The reply lives in the operator's conversation, not this chat's.
      expect(body.assistantMessage.tenantSlug).toBe(operator.slug);
      expect(body.assistantMessage.conversationId).not.toBe(conversation.id);
      const stored = await prisma.conversation.findUniqueOrThrow({ where: { id: body.assistantMessage.conversationId } });
      expect(stored.tenantId).toBe(operator.id);

      // The traveller's next message carries the new conversation id but still the platform's key.
      // It must be found under the operator and answered there, not rejected as unknown.
      const followUp = await POST(
        new NextRequest("http://localhost/api/widget/messages", {
          method: "POST",
          headers: { origin: "https://bluepass.co", "content-type": "application/json" },
          body: JSON.stringify({ key: platform.widgetPublicKey, conversationId: body.assistantMessage.conversationId, content: "what can I do there?" })
        })
      );
      expect(followUp.status).toBe(200);
      const followUpBody = await followUp.json();
      expect(followUpBody.assistantMessage.tenantSlug).toBe(operator.slug);
      expect(followUpBody.assistantMessage.conversationId).toBe(body.assistantMessage.conversationId);
    } finally {
      spy.mockRestore();
    }
  }, 90_000);
});
