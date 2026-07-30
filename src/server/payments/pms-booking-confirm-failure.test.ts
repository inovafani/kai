import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import * as pmsAdapterRegistry from "@/server/pms/pms-adapter-registry";
import * as tenantPmsCredentials from "@/server/pms/tenant-pms-credentials";
import * as whatsappClient from "@/server/whatsapp/client";
import { handlePmsBookingConfirmFailureRefundAndAlert } from "./pms-booking-confirm-failure";

vi.mock("@/server/whatsapp/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/whatsapp/client")>();
  return { ...actual, sendWhatsAppText: vi.fn(async () => ({ providerMessageId: "wamid.fake" })) };
});

function fakePmsAdapter(cancelBooking: () => Promise<{ cancelled: boolean }>) {
  return {
    provider: "REZDY" as const,
    listProducts: vi.fn(),
    getAvailability: vi.fn(),
    createBooking: vi.fn(),
    cancelBooking: vi.fn(cancelBooking),
    getBooking: vi.fn()
  };
}

async function createTestTenant(label: string, adminWhatsAppPhone: string | null) {
  return prisma.tenant.create({
    data: {
      slug: `pms-confirm-failure-${label}-${randomUUID()}`,
      name: `PMS Confirm Failure ${label}`,
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://boattime.example"],
      status: "ACTIVE",
      config: {
        create: {
          supportedChannels: ["WEB_WIDGET"],
          enabledFeatures: [],
          requiredSlots: {},
          bookingMode: "AUTO_BOOKING",
          adminWhatsAppPhone
        }
      }
    },
    include: { config: true }
  });
}

async function createTestAttempt(tenantId: string) {
  const conversation = await prisma.conversation.create({ data: { tenantId, channel: "WEB_WIDGET" } });

  return prisma.pmsBookingPaymentAttempt.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      pmsProvider: "REZDY",
      productExternalId: "boattime-whale-escape",
      productTitle: "Gold Coast Whale Escape",
      dateText: "2026-06-26 13:30:00",
      guests: 2,
      travellerName: "Test",
      travellerEmail: "test@gmail.com",
      grossAmountCents: 10000,
      currency: "AUD",
      externalBookingId: "RZ-HOLD-1",
      stripeCheckoutSessionId: `cs_${randomUUID()}`,
      stripePaymentIntentId: `pi_${randomUUID()}`,
      status: "PAID_AWAITING_CONFIRM"
    }
  });
}

describe("handlePmsBookingConfirmFailureRefundAndAlert", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refunds the traveller in full, posts an honest message, and alerts the tenant's admin WhatsApp on success", async () => {
    vi.spyOn(tenantPmsCredentials, "resolveTenantPmsEnv").mockResolvedValue({});
    vi.spyOn(pmsAdapterRegistry, "getPmsAdapter").mockReturnValue(fakePmsAdapter(async () => ({ cancelled: true })));

    const tenant = await createTestTenant("success", "6285337210180");
    const attempt = await createTestAttempt(tenant.id);
    const refundsCreate = vi.fn(async () => ({ id: "re_1" }));

    await handlePmsBookingConfirmFailureRefundAndAlert(
      { attempt, tenant, confirmError: new Error("Slot no longer available") },
      { stripeClient: { refunds: { create: refundsCreate } } as never, env: {} }
    );

    expect(refundsCreate).toHaveBeenCalledWith({ payment_intent: attempt.stripePaymentIntentId });

    const updated = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(updated.status).toBe("CONFIRM_FAILED_REFUNDED");
    expect(updated.failureReason).toBe("Slot no longer available");
    expect(updated.adminAlertSentAt).not.toBeNull();

    const messages = await prisma.message.findMany({ where: { conversationId: attempt.conversationId } });
    expect(messages.some((message) => message.content.includes("fully refunded"))).toBe(true);

    expect(whatsappClient.sendWhatsAppText).toHaveBeenCalledWith(
      expect.objectContaining({ to: "6285337210180", body: expect.stringContaining("auto-refunded") })
    );
  }, 30000);

  it("marks REFUND_FAILED and sends an urgent alert when the Stripe refund itself fails", async () => {
    vi.spyOn(tenantPmsCredentials, "resolveTenantPmsEnv").mockResolvedValue({});
    vi.spyOn(pmsAdapterRegistry, "getPmsAdapter").mockReturnValue(fakePmsAdapter(async () => ({ cancelled: true })));

    const tenant = await createTestTenant("refund-fails", "6285337210180");
    const attempt = await createTestAttempt(tenant.id);
    const refundsCreate = vi.fn(async () => {
      throw new Error("No such payment_intent");
    });

    await handlePmsBookingConfirmFailureRefundAndAlert(
      { attempt, tenant, confirmError: new Error("Slot no longer available") },
      { stripeClient: { refunds: { create: refundsCreate } } as never, env: {} }
    );

    const updated = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(updated.status).toBe("REFUND_FAILED");

    expect(whatsappClient.sendWhatsAppText).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("URGENT") })
    );

    const messages = await prisma.message.findMany({ where: { conversationId: attempt.conversationId } });
    expect(messages.some((message) => message.content.includes("processed manually"))).toBe(true);
  }, 30000);

  it("still completes the refund when no admin phone is configured anywhere", async () => {
    vi.spyOn(tenantPmsCredentials, "resolveTenantPmsEnv").mockResolvedValue({});
    vi.spyOn(pmsAdapterRegistry, "getPmsAdapter").mockReturnValue(fakePmsAdapter(async () => ({ cancelled: true })));

    const tenant = await createTestTenant("no-phone", null);
    const attempt = await createTestAttempt(tenant.id);
    const refundsCreate = vi.fn(async () => ({ id: "re_2" }));

    await handlePmsBookingConfirmFailureRefundAndAlert(
      { attempt, tenant, confirmError: new Error("Slot no longer available") },
      { stripeClient: { refunds: { create: refundsCreate } } as never, env: {} }
    );

    expect(refundsCreate).toHaveBeenCalled();
    const updated = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(updated.status).toBe("CONFIRM_FAILED_REFUNDED");
    expect(updated.adminAlertSentAt).toBeNull();
    expect(whatsappClient.sendWhatsAppText).not.toHaveBeenCalled();
  }, 30000);

  it("swallows a cancelBooking failure and still proceeds with the refund", async () => {
    vi.spyOn(tenantPmsCredentials, "resolveTenantPmsEnv").mockResolvedValue({});
    vi.spyOn(pmsAdapterRegistry, "getPmsAdapter").mockReturnValue(
      fakePmsAdapter(async () => {
        throw new Error("REZDY PMS adapter cancelBooking is not enabled.");
      })
    );

    const tenant = await createTestTenant("cancel-fails", "6285337210180");
    const attempt = await createTestAttempt(tenant.id);
    const refundsCreate = vi.fn(async () => ({ id: "re_3" }));

    await handlePmsBookingConfirmFailureRefundAndAlert(
      { attempt, tenant, confirmError: new Error("Slot no longer available") },
      { stripeClient: { refunds: { create: refundsCreate } } as never, env: {} }
    );

    expect(refundsCreate).toHaveBeenCalled();
    const updated = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(updated.status).toBe("CONFIRM_FAILED_REFUNDED");
  }, 30000);
});
