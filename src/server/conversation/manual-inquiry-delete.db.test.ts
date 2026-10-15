import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { deleteManualInquiryForTenantSlug } from "./conversation-repository";

// Real rows in the shared database; the tenants (and so everything under them) are removed afterwards.
const PREFIX = "inquiry-delete-";
const created: string[] = [];

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { in: created } } });
});

async function tenantWithInquiry() {
  const slug = `${PREFIX}${randomUUID()}`;
  created.push(slug);
  const tenant = await prisma.tenant.create({
    data: { slug, name: slug, widgetPublicKey: `pk_${randomUUID()}`, allowedOrigins: ["https://example.test"], status: "ACTIVE" }
  });
  const conversation = await prisma.conversation.create({ data: { tenantId: tenant.id, channel: "WEB_WIDGET" } });
  const inquiry = await prisma.manualInquiry.create({
    data: { tenantId: tenant.id, conversationId: conversation.id, travellerMessage: "hello", travellerName: "Test" }
  });
  return { slug, conversationId: conversation.id, inquiryId: inquiry.id };
}

describe("deleteManualInquiryForTenantSlug", () => {
  it("deletes the inquiry but keeps the conversation it came from", async () => {
    const { slug, conversationId, inquiryId } = await tenantWithInquiry();

    const result = await deleteManualInquiryForTenantSlug({ tenantSlug: slug, inquiryId });

    expect(result.count).toBe(1);
    expect(await prisma.manualInquiry.count({ where: { id: inquiryId } })).toBe(0);
    expect(await prisma.conversation.count({ where: { id: conversationId } })).toBe(1);
  }, 120_000);

  it("never deletes an inquiry through another tenant's address", async () => {
    const mine = await tenantWithInquiry();
    const other = await tenantWithInquiry();

    const result = await deleteManualInquiryForTenantSlug({ tenantSlug: other.slug, inquiryId: mine.inquiryId });

    expect(result.count).toBe(0);
    expect(await prisma.manualInquiry.count({ where: { id: mine.inquiryId } })).toBe(1);
    expect(await prisma.manualInquiry.count({ where: { id: other.inquiryId } })).toBe(1);
  }, 120_000);

  it("is harmless to repeat", async () => {
    const { slug, inquiryId } = await tenantWithInquiry();
    await deleteManualInquiryForTenantSlug({ tenantSlug: slug, inquiryId });
    expect((await deleteManualInquiryForTenantSlug({ tenantSlug: slug, inquiryId })).count).toBe(0);
  }, 120_000);
});
