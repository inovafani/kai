import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import * as pmsAdapterRegistry from "@/server/pms/pms-adapter-registry";
import * as tenantPmsCredentials from "@/server/pms/tenant-pms-credentials";
import * as whatsappClient from "@/server/whatsapp/client";
import { handlePmsBookingCheckoutSessionCompleted, handlePmsBookingCheckoutSessionExpired } from "./confirm-bluepass-pms-payment";
import type { PmsCreateBookingResult } from "@/core/pms/types";

vi.mock("@/server/whatsapp/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/whatsapp/client")>();
  return { ...actual, sendWhatsAppText: vi.fn(async () => ({ providerMessageId: "wamid.fake" })) };
});

async function createTestTenant(label: string) {
  return prisma.tenant.create({
    data: {
      slug: `confirm-pms-${label}-${randomUUID()}`,
      name: `Confirm PMS ${label}`,
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://boattime.example"],
      status: "ACTIVE"
    }
  });
}

async function createTestAttempt(input: { tenantId: string; sessionId: string; grossAmountCents?: number }) {
  const conversation = await prisma.conversation.create({
    data: { tenantId: input.tenantId, channel: "WEB_WIDGET" }
  });

  return prisma.pmsBookingPaymentAttempt.create({
    data: {
      tenantId: input.tenantId,
      conversationId: conversation.id,
      pmsProvider: "REZDY",
      productExternalId: "boattime-whale-escape",
      productTitle: "Gold Coast Whale Escape",
      dateText: "2026-06-26 13:30:00",
      guests: 2,
      travellerName: "Test",
      travellerEmail: "test@gmail.com",
      travellerPhone: "086775428176",
      grossAmountCents: input.grossAmountCents ?? 10000,
      currency: "AUD",
      externalBookingId: "RZ-HOLD-1",
      stripeCheckoutSessionId: input.sessionId,
      status: "AWAITING_PAYMENT"
    }
  });
}

describe("handlePmsBookingCheckoutSessionCompleted", () => {
  beforeEach(() => {
    vi.spyOn(tenantPmsCredentials, "resolveTenantPmsEnv").mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("confirms the PMS hold and posts the real 18% (5/5/3/5) ledger split on success", async () => {
    const tenant = await createTestTenant("success");
    const sessionId = `cs_${randomUUID()}`;
    const paymentIntentId = `pi_${randomUUID()}`;
    const attempt = await createTestAttempt({ tenantId: tenant.id, sessionId, grossAmountCents: 10000 });

    vi.spyOn(pmsAdapterRegistry, "getPmsAdapter").mockReturnValue({
      provider: "REZDY",
      listProducts: vi.fn(),
      getAvailability: vi.fn(),
      createBooking: vi.fn(),
      cancelBooking: vi.fn(),
      getBooking: vi.fn(),
      confirmBooking: vi.fn(async (): Promise<PmsCreateBookingResult> => ({ externalBookingId: "RZ-HOLD-1", provider: "REZDY", status: "CONFIRMED" }))
    });

    await handlePmsBookingCheckoutSessionCompleted({
      id: sessionId,
      payment_intent: paymentIntentId
    } as never);

    const updated = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(updated.status).toBe("CONFIRMED");
    expect(updated.stripePaymentIntentId).toBe(paymentIntentId);

    const ledgerEntries = await prisma.pmsBookingLedgerEntry.findMany({
      where: { pmsBookingPaymentAttemptId: attempt.id }
    });
    expect(ledgerEntries).toHaveLength(4);
    const conservation = ledgerEntries.find((entry) => entry.kind === "CONSERVATION_ALLOCATION");
    expect(conservation?.amountCents).toBe(500);
    expect(conservation?.status).toBe("FINALIZED");
    const operatorNet = ledgerEntries.find((entry) => entry.kind === "OPERATOR_PAYOUT_PLACEHOLDER");
    expect(operatorNet?.amountCents).toBe(8200);

    const messages = await prisma.message.findMany({ where: { conversationId: attempt.conversationId } });
    expect(messages.some((message) => message.content.includes("Payment received"))).toBe(true);
  }, 30000);

  it("alerts the operator's own admin WhatsApp on a successful booking confirmation", async () => {
    const createdTenant = await createTestTenant("success-alert");
    await prisma.tenant.update({
      where: { id: createdTenant.id },
      data: {
        config: {
          create: {
            supportedChannels: ["WEB_WIDGET"],
            enabledFeatures: [],
            requiredSlots: {},
            bookingMode: "AUTO_BOOKING",
            adminWhatsAppPhone: "6281111111111"
          }
        }
      }
    });
    const sessionId = `cs_${randomUUID()}`;
    const attempt = await createTestAttempt({ tenantId: createdTenant.id, sessionId });

    vi.spyOn(pmsAdapterRegistry, "getPmsAdapter").mockReturnValue({
      provider: "REZDY",
      listProducts: vi.fn(),
      getAvailability: vi.fn(),
      createBooking: vi.fn(),
      cancelBooking: vi.fn(),
      getBooking: vi.fn(),
      confirmBooking: vi.fn(async (): Promise<PmsCreateBookingResult> => ({ externalBookingId: "RZ-HOLD-1", provider: "REZDY", status: "CONFIRMED" }))
    });

    await handlePmsBookingCheckoutSessionCompleted({
      id: sessionId,
      payment_intent: `pi_${randomUUID()}`
    } as never);

    expect(whatsappClient.sendWhatsAppText).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "6281111111111",
        body: expect.stringContaining(attempt.productTitle)
      })
    );

    const updated = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(updated.adminAlertSentAt).not.toBeNull();
  }, 30000);

  it("does not alert when no admin WhatsApp phone is configured, and does not fail the webhook", async () => {
    const tenant = await createTestTenant("success-no-alert");
    const sessionId = `cs_${randomUUID()}`;
    const attempt = await createTestAttempt({ tenantId: tenant.id, sessionId });

    vi.spyOn(pmsAdapterRegistry, "getPmsAdapter").mockReturnValue({
      provider: "REZDY",
      listProducts: vi.fn(),
      getAvailability: vi.fn(),
      createBooking: vi.fn(),
      cancelBooking: vi.fn(),
      getBooking: vi.fn(),
      confirmBooking: vi.fn(async (): Promise<PmsCreateBookingResult> => ({ externalBookingId: "RZ-HOLD-1", provider: "REZDY", status: "CONFIRMED" }))
    });

    await handlePmsBookingCheckoutSessionCompleted({
      id: sessionId,
      payment_intent: `pi_${randomUUID()}`
    } as never);

    expect(whatsappClient.sendWhatsAppText).not.toHaveBeenCalled();
    const updated = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(updated.status).toBe("CONFIRMED");
    expect(updated.adminAlertSentAt).toBeNull();
  }, 30000);

  it("delegates to the refund+alert path when the PMS adapter cannot confirm the booking", async () => {
    const createdTenant = await createTestTenant("failure");
    await prisma.tenant.update({
      where: { id: createdTenant.id },
      data: {
        config: {
          create: {
            supportedChannels: ["WEB_WIDGET"],
            enabledFeatures: [],
            requiredSlots: {},
            bookingMode: "AUTO_BOOKING",
            adminWhatsAppPhone: "6281111111111"
          }
        }
      }
    });
    const sessionId = `cs_${randomUUID()}`;
    const attempt = await createTestAttempt({ tenantId: createdTenant.id, sessionId });

    vi.spyOn(pmsAdapterRegistry, "getPmsAdapter").mockReturnValue({
      provider: "REZDY",
      listProducts: vi.fn(),
      getAvailability: vi.fn(),
      createBooking: vi.fn(),
      cancelBooking: vi.fn(async () => {
        throw new Error("REZDY PMS adapter cancelBooking is not enabled.");
      }),
      getBooking: vi.fn(),
      confirmBooking: vi.fn(async (): Promise<PmsCreateBookingResult> => ({ externalBookingId: "RZ-HOLD-1", provider: "REZDY", status: "FAILED" }))
    });

    await handlePmsBookingCheckoutSessionCompleted({
      id: sessionId,
      payment_intent: `pi_${randomUUID()}`
    } as never);

    const updated = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(updated.status).toBe("REFUND_FAILED");
    expect(whatsappClient.sendWhatsAppText).toHaveBeenCalled();
  }, 30000);

  it("is idempotent when the same checkout.session.completed event is redelivered", async () => {
    const tenant = await createTestTenant("idempotent");
    const sessionId = `cs_${randomUUID()}`;
    const attempt = await createTestAttempt({ tenantId: tenant.id, sessionId });

    const confirmBooking = vi.fn(async (): Promise<PmsCreateBookingResult> => ({ externalBookingId: "RZ-HOLD-1", provider: "REZDY", status: "CONFIRMED" }));
    vi.spyOn(pmsAdapterRegistry, "getPmsAdapter").mockReturnValue({
      provider: "REZDY",
      listProducts: vi.fn(),
      getAvailability: vi.fn(),
      createBooking: vi.fn(),
      cancelBooking: vi.fn(),
      getBooking: vi.fn(),
      confirmBooking
    });

    const paymentIntentId = `pi_${randomUUID()}`;
    await handlePmsBookingCheckoutSessionCompleted({ id: sessionId, payment_intent: paymentIntentId } as never);
    await handlePmsBookingCheckoutSessionCompleted({ id: sessionId, payment_intent: paymentIntentId } as never);

    expect(confirmBooking).toHaveBeenCalledTimes(1);
    const ledgerEntries = await prisma.pmsBookingLedgerEntry.findMany({
      where: { pmsBookingPaymentAttemptId: attempt.id }
    });
    expect(ledgerEntries).toHaveLength(4);
  }, 30000);

  it("does nothing for an unknown checkout session id", async () => {
    await expect(
      handlePmsBookingCheckoutSessionCompleted({ id: "cs_never_created", payment_intent: null } as never)
    ).resolves.toBeUndefined();
  });
});

describe("handlePmsBookingCheckoutSessionExpired", () => {
  it("marks a pending attempt PAYMENT_FAILED", async () => {
    const tenant = await createTestTenant("expired");
    const sessionId = `cs_${randomUUID()}`;
    const attempt = await createTestAttempt({ tenantId: tenant.id, sessionId });

    vi.spyOn(tenantPmsCredentials, "resolveTenantPmsEnv").mockResolvedValue({});
    vi.spyOn(pmsAdapterRegistry, "getPmsAdapter").mockReturnValue({
      provider: "REZDY",
      listProducts: vi.fn(),
      getAvailability: vi.fn(),
      createBooking: vi.fn(),
      cancelBooking: vi.fn(async () => ({ cancelled: true })),
      getBooking: vi.fn()
    });

    await handlePmsBookingCheckoutSessionExpired({ id: sessionId } as never);

    const updated = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(updated.status).toBe("PAYMENT_FAILED");

    vi.restoreAllMocks();
  }, 30000);
});
