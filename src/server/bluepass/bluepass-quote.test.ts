import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createOrReuseBluePassInquiry, handleBluePassOperatorResponse } from "./bluepass-inquiry-repository";
import { getBluePassQuote } from "./bluepass-quote";
import { prisma } from "@/lib/prisma";

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
