import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { listBluePassInquiriesForTenantSlug } from "@/server/bluepass/bluepass-inquiry-repository";

vi.mock("@/server/bluepass/bluepass-inquiry-repository", () => ({
  listBluePassInquiriesForTenantSlug: vi.fn()
}));

const listBluePassInquiriesForTenantSlugMock = vi.mocked(listBluePassInquiriesForTenantSlug);

describe("GET /api/admin/[tenantSlug]/bluepass-inquiries", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.KAI_ADMIN_TOKEN;
  });

  it("requires the Kai admin token", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";

    const response = await GET(new Request("http://localhost/api/admin/bluepass/bluepass-inquiries"), {
      params: Promise.resolve({ tenantSlug: "bluepass" })
    });

    expect(response.status).toBe(401);
    expect(listBluePassInquiriesForTenantSlugMock).not.toHaveBeenCalled();
  });

  it("returns BluePass inquiries for the tenant when the bearer token is valid", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    listBluePassInquiriesForTenantSlugMock.mockResolvedValueOnce([
      {
        id: "inq_1",
        tenantId: "tenant_1",
        conversationId: "conversation_1",
        sourceChannel: "WEB_WIDGET",
        status: "OPERATOR_ACCEPTED",
        travellerName: "Inov",
        travellerEmail: "inov@example.com",
        travellerPhone: "6285156246329",
        destination: "Komodo",
        tripType: "liveaboard",
        dateWindow: "6 July 2026",
        guests: 4,
        budget: "Quote requested",
        interests: [],
        selectedYachtSlug: "calico-jack",
        selectedYachtName: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone: "6285337210180",
        notes: "Selected yacht: calico-jack",
        travellerMessage: "Calico Jack for 6 July 2026",
        referralPartnerId: null,
        referralLinkId: null,
        referralCode: null,
        referralRole: null,
        createdAt: new Date("2026-07-01T05:00:00.000Z"),
        updatedAt: new Date("2026-07-01T05:01:00.000Z"),
        tenant: { id: "tenant_1", slug: "bluepass", name: "BluePass" },
        events: [
          {
            id: "event_1",
            tenantId: "tenant_1",
            conversationId: "conversation_1",
            bluePassInquiryId: "inq_1",
            type: "OPERATOR_RESPONSE_ACCEPTED",
            fromStatus: "OPERATOR_PENDING",
            toStatus: "OPERATOR_ACCEPTED",
            metadata: { providerMessageId: "wamid_1" },
            createdAt: new Date("2026-07-01T05:01:00.000Z")
          }
        ],
        ledger: [],
        dispatches: []
      }
    ]);

    const response = await GET(
      new Request("http://localhost/api/admin/bluepass/bluepass-inquiries?take=12", {
        headers: { authorization: "Bearer admin_secret" }
      }),
      { params: Promise.resolve({ tenantSlug: "bluepass" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(listBluePassInquiriesForTenantSlugMock).toHaveBeenCalledWith({
      tenantSlug: "bluepass",
      take: 12
    });
    expect(body).toMatchObject({
      inquiries: [
        {
          id: "inq_1",
          tenant: { slug: "bluepass", name: "BluePass" },
          selectedYachtName: "Calico Jack",
          status: "OPERATOR_ACCEPTED",
          events: [
            {
              type: "OPERATOR_RESPONSE_ACCEPTED",
              metadata: { providerMessageId: "wamid_1" }
            }
          ]
        }
      ]
    });
  });
});
