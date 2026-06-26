import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createOrReuseBluePassInquiry,
  dispatchBluePassOperatorWhatsApp,
  getActiveBluePassInquiryStatus,
  syncBluePassReferralLedgerEstimate
} from "./bluepass-inquiry-repository";

describe("bluepass inquiry repository", () => {
  it("creates and reads a tenant conversation scoped BluePass inquiry", async () => {
    const tenantId = `tenant_${randomUUID()}`;
    const conversationId = `conversation_${randomUUID()}`;

    const created = await createOrReuseBluePassInquiry({
      tenantId,
      conversationId,
      travellerMessage: "Komodo yacht for 8 guests next month",
      intent: {
        destination: "Komodo",
        dateWindow: "next month",
        guests: 8,
        travellerName: "Maya Chen",
        travellerEmail: "maya@example.com",
        travellerPhone: "+61 400 111 222"
      },
      selectedYacht: {
        slug: "alexa",
        name: "Alexa",
        operatorId: "operator_alexa",
        operatorName: "Alexa Charters",
        operatorPhone: "+6281234567890"
      },
      referral: {
        referralPartnerId: "partner_creator_1",
        referralLinkId: "link_1",
        referralCode: "CREATOR42",
        referralRole: "CREATOR"
      }
    });

    expect(created.reusedExisting).toBe(false);
    expect(created.inquiry).toMatchObject({
      tenantId,
      conversationId,
      status: "READY_TO_DISPATCH",
      destination: "Komodo",
      guests: 8,
      selectedYachtSlug: "alexa",
      referralCode: "CREATOR42"
    });

    const status = await getActiveBluePassInquiryStatus({
      tenantId,
      conversationId
    });

    expect(status?.inquiry).toMatchObject({
      id: created.inquiry.id,
      status: "READY_TO_DISPATCH",
      selectedYachtName: "Alexa"
    });
    expect(status?.events.at(-1)).toMatchObject({
      type: "INQUIRY_CREATED"
    });
  });

  it("reuses the active inquiry for the same tenant conversation", async () => {
    const tenantId = `tenant_${randomUUID()}`;
    const conversationId = `conversation_${randomUUID()}`;

    const first = await createOrReuseBluePassInquiry({
      tenantId,
      conversationId,
      travellerMessage: "Komodo for 8 guests next month",
      intent: {
        destination: "Komodo",
        dateWindow: "next month",
        guests: 8,
        travellerName: "Maya Chen",
        travellerEmail: "maya@example.com",
        travellerPhone: "+61 400 111 222"
      }
    });
    const second = await createOrReuseBluePassInquiry({
      tenantId,
      conversationId,
      travellerMessage: "Actually budget is USD 10000",
      intent: {
        destination: "Komodo",
        dateWindow: "next month",
        guests: 8,
        budget: "USD 10000",
        travellerName: "Maya Chen",
        travellerEmail: "maya@example.com",
        travellerPhone: "+61 400 111 222"
      }
    });

    expect(second.reusedExisting).toBe(true);
    expect(second.inquiry.id).toBe(first.inquiry.id);
    expect(second.inquiry.budget).toBe("USD 10000");
  });

  it("syncs referral ledger estimates and dispatches an operator WhatsApp stub", async () => {
    const tenantId = `tenant_${randomUUID()}`;
    const conversationId = `conversation_${randomUUID()}`;
    const created = await createOrReuseBluePassInquiry({
      tenantId,
      conversationId,
      travellerMessage: "Komodo yacht for 8 guests next month around USD 10000",
      intent: {
        destination: "Komodo",
        dateWindow: "next month",
        guests: 8,
        budget: "USD 10000",
        travellerName: "Maya Chen",
        travellerEmail: "maya@example.com",
        travellerPhone: "+61 400 111 222"
      },
      selectedYacht: {
        slug: "alila-purnama",
        name: "Alila Purnama",
        operatorId: "operator_alila_purnama",
        operatorName: "Alila Purnama",
        operatorPhone: "+6281234567001"
      },
      referral: {
        referralPartnerId: "partner_creator_1",
        referralLinkId: "link_1",
        referralCode: "CREATOR42",
        referralRole: "CREATOR"
      }
    });

    const ledger = await syncBluePassReferralLedgerEstimate(created.inquiry);
    const dispatch = await dispatchBluePassOperatorWhatsApp({
      inquiryId: created.inquiry.id
    });

    expect(ledger).toHaveLength(4);
    expect(ledger.map((entry) => entry.kind)).toContain("CONSERVATION_ALLOCATION");
    expect(dispatch).toMatchObject({
      status: "QUEUED",
      operatorPhone: "+6281234567001"
    });

    const status = await getActiveBluePassInquiryStatus({
      tenantId,
      conversationId
    });

    expect(status?.inquiry.status).toBe("OPERATOR_PENDING");
    expect(status?.dispatches[0]).toMatchObject({
      id: dispatch.id,
      status: "QUEUED"
    });
  }, 20_000);
});
