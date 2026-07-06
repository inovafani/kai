import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOrReuseBluePassInquiry, handleBluePassOperatorResponse } from "./bluepass-inquiry-repository";
import { approveBluePassQuote, getBluePassQuote } from "./bluepass-quote";
import { prisma } from "@/lib/prisma";

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.META_GRAPH_VERSION;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_PHONE_ID_KAI;
  delete process.env.WHATSAPP_PHONE_ID_OPS;
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("bluepass quote", () => {
  it("creates a ready quote from operator counter details", async () => {
    const { tenantId, conversationId } = await createTestConversation("counter");
    const created = await createOrReuseBluePassInquiry({
      tenantId,
      conversationId,
      travellerMessage: "Calico Jack Komodo for 2 guests on 4 July",
      intent: {
        destination: "Komodo",
        dateWindow: "4 July",
        guests: 2,
        travellerName: "Inova",
        travellerEmail: "inova@example.com",
        travellerPhone: "6285156246329"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone: "6285337210180"
      }
    });

    await handleBluePassOperatorResponse({
      inquiryId: created.inquiry.id,
      action: "counter",
      counterText:
        "Original 4 July is unavailable. Available 6 July, price USD 3,900 per cabin/night for 2 guests, includes full board meals, dives, crew, tanks, and weights. Excludes flights, park fees, alcohol, tips, and transfers. Condition: 30% deposit to hold."
    });

    const quote = await getBluePassQuote({ quoteId: created.inquiry.id });

    expect(quote).toMatchObject({
      id: created.inquiry.id,
      status: "READY_FOR_TRAVELLER",
      inquiryId: created.inquiry.id,
      selectedYachtName: "Calico Jack",
      destination: "Komodo",
      dateWindow: "6 July",
      guests: 2,
      currency: "USD",
      grossPriceCents: 390000,
      conservationContributionCents: 19500
    });
    expect(quote?.inclusions).toContain("full board meals");
    expect(quote?.exclusions).toContain("flights");
    expect(quote?.terms).toContain("30% deposit");
  });

  it("prefers the final USD price over the year in counter details", async () => {
    const { tenantId, conversationId } = await createTestConversation("counter-year-price");
    const created = await createOrReuseBluePassInquiry({
      tenantId,
      conversationId,
      travellerMessage: "Calico Jack Komodo for 4 guests on 17 July",
      intent: {
        destination: "Komodo",
        dateWindow: "17 July",
        guests: 4,
        travellerName: "Putra",
        travellerEmail: "putra@example.com",
        travellerPhone: "6285156246329"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone: "6285337210180"
      }
    });

    await handleBluePassOperatorResponse({
      inquiryId: created.inquiry.id,
      action: "counter",
      counterText:
        "Available 18 July 2026. Final price USD 3,900 per cabin/night for 4 guests. Includes full board meals, daily dives, crew, tanks, weights, and airport transfers. Excludes flights, park fees, alcohol, tips, and personal expenses. Condition: 30% deposit to hold, balance due 30 days before departure."
    });

    const quote = await getBluePassQuote({ quoteId: created.inquiry.id });

    expect(quote).toMatchObject({
      dateWindow: "18 July",
      currency: "USD",
      grossPriceCents: 390000,
      conservationContributionCents: 19500
    });
  });

  it("creates a needs-price quote when the operator accepts without final price", async () => {
    const { tenantId, conversationId } = await createTestConversation("accept");
    const created = await createOrReuseBluePassInquiry({
      tenantId,
      conversationId,
      travellerMessage: "Aliikai Raja Ampat for 3 guests on 12 August",
      intent: {
        destination: "Raja Ampat",
        dateWindow: "12 August",
        guests: 3,
        travellerName: "Maya",
        travellerEmail: "maya@example.com",
        travellerPhone: "6285156246329"
      },
      selectedYacht: {
        slug: "aliikai",
        name: "Aliikai",
        operatorId: "operator_aliikai",
        operatorName: "Aliikai",
        operatorPhone: "6285337210180"
      }
    });

    await handleBluePassOperatorResponse({
      inquiryId: created.inquiry.id,
      action: "accept"
    });

    const quote = await getBluePassQuote({ quoteId: created.inquiry.id });

    expect(quote).toMatchObject({
      id: created.inquiry.id,
      status: "NEEDS_FINAL_PRICE",
      selectedYachtName: "Aliikai",
      dateWindow: "12 August",
      guests: 3,
      grossPriceCents: null,
      conservationContributionCents: null
    });
  });

  it("notifies operator and traveller when the traveller approves a quote", async () => {
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";
    process.env.WHATSAPP_PHONE_ID_OPS = "1115079071692326";

    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        messages: [{ id: `wamid.${randomUUID()}` }]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { tenantId, conversationId } = await createTestConversation("approval-notify");
    const created = await createOrReuseBluePassInquiry({
      tenantId,
      conversationId,
      travellerMessage: "Calico Jack Komodo for 2 guests on 20 July",
      intent: {
        destination: "Komodo",
        dateWindow: "20 July",
        guests: 2,
        travellerName: "Putro",
        travellerEmail: "putro@example.com",
        travellerPhone: "085156246329"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone: "6285337210180"
      }
    });

    await handleBluePassOperatorResponse({
      inquiryId: created.inquiry.id,
      action: "counter",
      counterText:
        "Available 22 July 2026. Final price USD 3,900 per cabin/night for 2 guests. Includes full board meals, daily dives, crew, tanks, weights, and airport transfers. Excludes flights, park fees, alcohol, tips, and personal expenses. Condition: 30% deposit to hold, balance due 30 days before departure."
    });
    fetchMock.mockClear();

    const quote = await approveBluePassQuote({ quoteId: created.inquiry.id });
    const sentBodies = fetchMock.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)));
    const events = await prisma.bluePassInquiryEvent.findMany({
      where: {
        bluePassInquiryId: created.inquiry.id,
        type: {
          in: [
            "BLUEPASS_QUOTE_APPROVED",
            "QUOTE_APPROVAL_OPERATOR_NOTIFICATION_SENT",
            "QUOTE_APPROVAL_TRAVELLER_NOTIFICATION_SENT"
          ]
        }
      },
      orderBy: { createdAt: "asc" }
    });

    expect(quote).toMatchObject({
      status: "TRAVELLER_APPROVED",
      selectedYachtName: "Calico Jack",
      dateWindow: "22 July"
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBodies[0]).toMatchObject({
      to: "6285337210180",
      type: "text"
    });
    expect(sentBodies[0].text.body).toContain("Putro approved the BluePass quote");
    expect(sentBodies[0].text.body).toContain("Please hold the slot");
    expect(sentBodies[0].text.body).toContain("payment path");
    expect(sentBodies[1]).toMatchObject({
      to: "085156246329",
      type: "text"
    });
    expect(sentBodies[1].text.body).toContain("Your BluePass quote for Calico Jack is approved");
    expect(sentBodies[1].text.body).toContain("payment path");
    expect(events.map((event) => event.type)).toEqual([
      "BLUEPASS_QUOTE_APPROVED",
      "QUOTE_APPROVAL_OPERATOR_NOTIFICATION_SENT",
      "QUOTE_APPROVAL_TRAVELLER_NOTIFICATION_SENT"
    ]);
  }, 20_000);

  it("surfaces payment-ready and booking-confirmed operational status on the quote", async () => {
    const { tenantId, conversationId } = await createTestConversation("operational-status");
    const created = await createOrReuseBluePassInquiry({
      tenantId,
      conversationId,
      travellerMessage: "Calico Jack Komodo for 2 guests on 20 July",
      intent: {
        destination: "Komodo",
        dateWindow: "20 July",
        guests: 2,
        travellerName: "Putro",
        travellerEmail: "putro@example.com",
        travellerPhone: "085156246329"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone: "6285337210180"
      }
    });

    await handleBluePassOperatorResponse({
      inquiryId: created.inquiry.id,
      action: "counter",
      counterText:
        "Available 22 July 2026. Final price USD 3,900 per cabin/night for 2 guests. Includes full board meals. Excludes flights. Condition: 30% deposit to hold."
    });
    await prisma.bluePassInquiryEvent.create({
      data: {
        tenantId,
        conversationId,
        bluePassInquiryId: created.inquiry.id,
        type: "BLUEPASS_QUOTE_APPROVED",
        fromStatus: "COUNTER_OFFERED",
        toStatus: "COUNTER_OFFERED",
        metadata: {
          quoteId: created.inquiry.id,
          previousQuoteStatus: "READY_FOR_TRAVELLER",
          nextQuoteStatus: "TRAVELLER_APPROVED"
        }
      }
    });
    await prisma.bluePassInquiryEvent.create({
      data: {
        tenantId,
        conversationId,
        bluePassInquiryId: created.inquiry.id,
        type: "OPERATOR_PAYMENT_READY",
        fromStatus: "COUNTER_OFFERED",
        toStatus: "COUNTER_OFFERED",
        metadata: {
          paymentText: "Slot held. Payment link: https://pay.example/cj-22. Booking reference CJ-2207."
        }
      }
    });

    const paymentQuote = await getBluePassQuote({ quoteId: created.inquiry.id });
    expect(paymentQuote).toMatchObject({
      status: "TRAVELLER_APPROVED",
      operationalStatus: "PAYMENT_READY",
      paymentText: "Slot held. Payment link: https://pay.example/cj-22. Booking reference CJ-2207.",
      confirmationText: null
    });

    await prisma.bluePassInquiryEvent.create({
      data: {
        tenantId,
        conversationId,
        bluePassInquiryId: created.inquiry.id,
        type: "OPERATOR_BOOKING_CONFIRMED",
        fromStatus: "COUNTER_OFFERED",
        toStatus: "CLOSED",
        metadata: {
          confirmationText: "Payment received. Booking confirmed for 22 July. Booking reference CJ-2207."
        }
      }
    });

    const confirmedQuote = await getBluePassQuote({ quoteId: created.inquiry.id });
    expect(confirmedQuote).toMatchObject({
      operationalStatus: "BOOKING_CONFIRMED",
      paymentText: "Slot held. Payment link: https://pay.example/cj-22. Booking reference CJ-2207.",
      confirmationText: "Payment received. Booking confirmed for 22 July. Booking reference CJ-2207."
    });
  }, 20_000);
});

async function createTestConversation(label: string) {
  const tenant = await prisma.tenant.create({
    data: {
      slug: `bluepass-quote-${label}-${randomUUID()}`,
      name: `BluePass Quote ${label}`,
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://bluepass.co"],
      status: "ACTIVE"
    }
  });
  const conversation = await prisma.conversation.create({
    data: {
      tenantId: tenant.id,
      channel: "WEB_WIDGET"
    }
  });

  return {
    tenantId: tenant.id,
    conversationId: conversation.id
  };
}
