import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleBluePassMarketplaceMessage } from "./bluepass-message-flow";

describe("handleBluePassMarketplaceMessage", () => {
  it("returns preview matches and asks for missing inquiry fields", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "Can Kai find me a yacht in Komodo for 8 guests next month?",
      priorTravellerMessages: []
    });

    expect(result.bluepassMatches[0]).toMatchObject({
      region: "Komodo",
      truth: {
        availabilitySource: "preview_catalog"
      }
    });
    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.assistantContent).toContain("Please share your name, email, and phone");
    expect(result.paymentRequest).toBeNull();
  });

  it("creates inquiry, ledger estimate, and dispatch when required fields are present", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content:
        "Please send inquiry for Alila Purnama in Komodo next month for 8 guests around USD 10000. My name is Maya Chen, email maya@example.com, phone +61 400 111 222",
      priorTravellerMessages: [],
      referral: {
        referralPartnerId: "partner_creator_1",
        referralLinkId: "link_1",
        referralCode: "CREATOR42",
        referralRole: "CREATOR"
      }
    });

    expect(result.bluepassInquiry).toMatchObject({
      status: "OPERATOR_PENDING",
      destination: "Komodo",
      guests: 8,
      selectedYachtSlug: "alila-purnama",
      referralCode: "CREATOR42"
    });
    expect(result.bluepassLedger.map((entry) => entry.kind)).toEqual([
      "CREATOR_COMMISSION_ESTIMATE",
      "BLUEPASS_PLATFORM_COMMISSION",
      "CONSERVATION_ALLOCATION",
      "OPERATOR_PAYOUT_PLACEHOLDER"
    ]);
    expect(result.bluepassDispatch).toMatchObject({
      status: "QUEUED",
      operatorPhone: "+6281234567001"
    });
    expect(result.assistantContent).toContain("I prepared BluePass inquiry");
    expect(result.assistantContent).toContain("not a confirmed booking");
    expect(result.paymentRequest).toBeNull();
  }, 20_000);
});
