import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { findOrCreateWhatsAppConversation, setWhatsAppConversationControlMode } from "./conversation-repository";

async function createTestTenant(label: string) {
  return prisma.tenant.create({
    data: {
      slug: `conversation-repo-${label}-${randomUUID()}`,
      name: `Conversation Repo ${label} Test`,
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://example.test"],
      status: "ACTIVE"
    }
  });
}

describe("findOrCreateWhatsAppConversation", () => {
  it("creates a new AI-mode WhatsApp conversation when none exists for the phone", async () => {
    const tenant = await createTestTenant("create");
    const whatsappPhone = "6281111100001";

    const conversation = await findOrCreateWhatsAppConversation({ tenantId: tenant.id, whatsappPhone });

    expect(conversation.tenantId).toBe(tenant.id);
    expect(conversation.channel).toBe("WHATSAPP");
    expect(conversation.controlMode).toBe("AI");
    expect(conversation.whatsappPhone).toBe(whatsappPhone);
  });

  it("reuses the existing conversation for the same tenant and phone instead of creating a second one", async () => {
    const tenant = await createTestTenant("reuse");
    const whatsappPhone = "6281111100002";

    const first = await findOrCreateWhatsAppConversation({ tenantId: tenant.id, whatsappPhone });
    const second = await findOrCreateWhatsAppConversation({ tenantId: tenant.id, whatsappPhone });

    expect(second.id).toBe(first.id);
    const conversations = await prisma.conversation.findMany({
      where: { tenantId: tenant.id, whatsappPhone }
    });
    expect(conversations).toHaveLength(1);
  });

  it("keeps two tenants' conversations separate even when they share the same WhatsApp phone", async () => {
    const whatsappPhone = "6281111100003";
    const tenantA = await createTestTenant("tenant-a");
    const tenantB = await createTestTenant("tenant-b");

    const conversationA = await findOrCreateWhatsAppConversation({ tenantId: tenantA.id, whatsappPhone });
    const conversationB = await findOrCreateWhatsAppConversation({ tenantId: tenantB.id, whatsappPhone });

    expect(conversationA.id).not.toBe(conversationB.id);
    expect(conversationA.tenantId).toBe(tenantA.id);
    expect(conversationB.tenantId).toBe(tenantB.id);
  });
});

describe("setWhatsAppConversationControlMode", () => {
  it("flips control mode on an existing WhatsApp conversation", async () => {
    const tenant = await createTestTenant("control-existing");
    const whatsappPhone = "6281111100004";
    const existing = await findOrCreateWhatsAppConversation({ tenantId: tenant.id, whatsappPhone });
    expect(existing.controlMode).toBe("AI");

    const updated = await setWhatsAppConversationControlMode({
      tenantId: tenant.id,
      whatsappPhone,
      controlMode: "HUMAN"
    });

    expect(updated.id).toBe(existing.id);
    expect(updated.controlMode).toBe("HUMAN");
  });

  it("creates the conversation with the requested control mode when a human replies before Kai ever sees the thread", async () => {
    const tenant = await createTestTenant("control-new");
    const whatsappPhone = "6281111100005";

    const created = await setWhatsAppConversationControlMode({
      tenantId: tenant.id,
      whatsappPhone,
      controlMode: "PAUSED"
    });

    expect(created.tenantId).toBe(tenant.id);
    expect(created.whatsappPhone).toBe(whatsappPhone);
    expect(created.controlMode).toBe("PAUSED");

    const conversations = await prisma.conversation.findMany({
      where: { tenantId: tenant.id, whatsappPhone }
    });
    expect(conversations).toHaveLength(1);
  });
});
