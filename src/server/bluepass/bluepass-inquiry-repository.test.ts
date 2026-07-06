import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOrReuseBluePassInquiry,
  dispatchBluePassOperatorWhatsApp,
  getActiveBluePassInquiryStatus,
  handleBluePassOperatorResponse,
  listBluePassInquiriesForTenantSlug,
  resolveLatestPendingBluePassInquiryIdForOperatorPhone,
  syncBluePassReferralLedgerEstimate
} from "./bluepass-inquiry-repository";
import { approveBluePassQuote } from "./bluepass-quote";
import { prisma } from "@/lib/prisma";

const originalEnv = { ...process.env };
const isolatedWhatsAppEnvKeys = [
  "BLUEPASS_TEST_OPERATOR_PHONE",
  "BLUEPASS_FORCE_TEST_OPERATOR_PHONE",
  "BLUEPASS_OPERATOR_PHONE_OVERRIDES",
  "BLUEPASS_APP_URL",
  "BLUEPASS_APP_SERVICE_TOKEN",
  "KAI_ADMIN_TOKEN",
  "KAI_CORE_ADMIN_TOKEN",
  "WHATSAPP_OPERATOR_INQUIRY_SEND_MODE",
  "WHATSAPP_TRAVELLER_NOTIFY_SEND_MODE",
  "WHATSAPP_TRAVELLER_UPDATE_TEMPLATE",
  "WHATSAPP_TRAVELLER_UPDATE_TEMPLATE_LANGUAGE",
  "WHATSAPP_OPERATOR_COUNTER_REQUEST_SEND_MODE",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  "META_GRAPH_VERSION",
  "WHATSAPP_PHONE_ID_KAI",
  "WHATSAPP_PHONE_ID_OPS",
  "WHATSAPP_ACCESS_TOKEN"
];

beforeEach(() => {
  for (const key of isolatedWhatsAppEnvKeys) {
    delete process.env[key];
  }
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

  it("keeps the selected yacht operator phone when a test operator phone is configured", async () => {
    process.env.BLUEPASS_TEST_OPERATOR_PHONE = "6285337210180";

    const tenantId = `tenant_${randomUUID()}`;
    const conversationId = `conversation_${randomUUID()}`;
    const created = await createOrReuseBluePassInquiry({
      tenantId,
      conversationId,
      travellerMessage: "Komodo yacht for 4 guests in July",
      intent: {
        destination: "Komodo",
        dateWindow: "July 2026",
        guests: 4,
        travellerName: "Eka",
        travellerEmail: "eka@example.com",
        travellerPhone: "0876634231987"
      },
      selectedYacht: {
        slug: "alila-purnama",
        name: "Alila Purnama",
        operatorId: "operator_alila_purnama",
        operatorName: "Alila Purnama",
        operatorPhone: "+6281234567001"
      }
    });

    const dispatch = await dispatchBluePassOperatorWhatsApp({
      inquiryId: created.inquiry.id
    });
    const status = await getActiveBluePassInquiryStatus({
      tenantId,
      conversationId
    });

    expect(dispatch.operatorPhone).toBe("+6281234567001");
    expect(status?.inquiry.operatorPhone).toBe("+6281234567001");
    expect(status?.dispatches[0]).toMatchObject({
      status: "QUEUED",
      operatorPhone: "+6281234567001"
    });
  }, 50_000);

  it("routes operator dispatches to a forced BluePass test operator phone in local demo mode", async () => {
    process.env.BLUEPASS_TEST_OPERATOR_PHONE = "6285337210180";
    process.env.BLUEPASS_FORCE_TEST_OPERATOR_PHONE = "true";

    const tenantId = `tenant_${randomUUID()}`;
    const conversationId = `conversation_${randomUUID()}`;
    const created = await createOrReuseBluePassInquiry({
      tenantId,
      conversationId,
      travellerMessage: "Komodo yacht for 4 guests in July",
      intent: {
        destination: "Komodo",
        dateWindow: "July 2026",
        guests: 4,
        travellerName: "Eka",
        travellerEmail: "eka@example.com",
        travellerPhone: "0876634231987"
      },
      selectedYacht: {
        slug: "alila-purnama",
        name: "Alila Purnama",
        operatorId: "operator_alila_purnama",
        operatorName: "Alila Purnama",
        operatorPhone: "+6281234567001"
      }
    });

    const dispatch = await dispatchBluePassOperatorWhatsApp({
      inquiryId: created.inquiry.id
    });

    expect(dispatch.operatorPhone).toBe("6285337210180");
  }, 20_000);

  it("does not silently fall back to the BluePass test operator phone when forced demo mode is off", async () => {
    process.env.BLUEPASS_TEST_OPERATOR_PHONE = "6285337210180";
    process.env.BLUEPASS_FORCE_TEST_OPERATOR_PHONE = "false";

    const created = await createOrReuseBluePassInquiry({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      travellerMessage: "Alila Purnama in Komodo for 2 guests in July",
      intent: {
        destination: "Komodo",
        dateWindow: "July 2026",
        guests: 2,
        travellerName: "Eka",
        travellerEmail: "eka@example.com",
        travellerPhone: "0876634231987"
      },
      selectedYacht: {
        slug: "alila-purnama",
        name: "Alila Purnama",
        operatorId: "operator_alila_purnama",
        operatorName: "Alila Purnama",
        operatorPhone: null
      }
    });

    expect(created.inquiry.operatorPhone).toBeNull();
  }, 20_000);

  it("routes operator dispatches to per-operator phone overrides by yacht slug", async () => {
    process.env.BLUEPASS_OPERATOR_PHONE_OVERRIDES = JSON.stringify({
      "alila-purnama": "6281111111111",
      "operator_calico_jack": "6282222222222"
    });

    const tenantId = `tenant_${randomUUID()}`;
    const conversationId = `conversation_${randomUUID()}`;
    const created = await createOrReuseBluePassInquiry({
      tenantId,
      conversationId,
      travellerMessage: "Komodo yacht for 4 guests in July",
      intent: {
        destination: "Komodo",
        dateWindow: "July 2026",
        guests: 4,
        travellerName: "Eka",
        travellerEmail: "eka@example.com",
        travellerPhone: "0876634231987"
      },
      selectedYacht: {
        slug: "alila-purnama",
        name: "Alila Purnama",
        operatorId: "operator_alila_purnama",
        operatorName: "Alila Purnama",
        operatorPhone: "+6281234567001"
      }
    });

    const dispatch = await dispatchBluePassOperatorWhatsApp({
      inquiryId: created.inquiry.id
    });
    const status = await getActiveBluePassInquiryStatus({
      tenantId,
      conversationId
    });

    expect(dispatch.operatorPhone).toBe("6281111111111");
    expect(status?.inquiry.operatorPhone).toBe("6281111111111");
  }, 20_000);

  it("routes operator dispatches to per-operator phone overrides by operator id", async () => {
    process.env.BLUEPASS_OPERATOR_PHONE_OVERRIDES = JSON.stringify({
      operator_calico_jack: "6282222222222"
    });

    const created = await createOrReuseBluePassInquiry({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      travellerMessage: "Calico Jack in Komodo for 4 guests in July",
      intent: {
        destination: "Komodo",
        dateWindow: "July 2026",
        guests: 4,
        travellerName: "Eka",
        travellerEmail: "eka@example.com",
        travellerPhone: "0876634231987"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone: "+6281234567004"
      }
    });

    const dispatch = await dispatchBluePassOperatorWhatsApp({
      inquiryId: created.inquiry.id
    });

    expect(dispatch.operatorPhone).toBe("6282222222222");
  }, 20_000);

  it("does not use preview catalog placeholder operator phones in production without an override", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.BLUEPASS_TEST_OPERATOR_PHONE = "6285337210180";

    const created = await createOrReuseBluePassInquiry({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      travellerMessage: "Calico Jack in Komodo for 4 guests in July",
      intent: {
        destination: "Komodo",
        dateWindow: "July 2026",
        guests: 4,
        travellerName: "Eka",
        travellerEmail: "eka@example.com",
        travellerPhone: "0876634231987"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone: "+6281234567004"
      }
    });

    expect(created.inquiry.operatorPhone).toBeNull();
  }, 20_000);

  it("uses per-operator phone overrides in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.BLUEPASS_OPERATOR_PHONE_OVERRIDES = JSON.stringify({
      "calico-jack": "6283333333333"
    });

    const created = await createOrReuseBluePassInquiry({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      travellerMessage: "Calico Jack in Komodo for 4 guests in July",
      intent: {
        destination: "Komodo",
        dateWindow: "July 2026",
        guests: 4,
        travellerName: "Eka",
        travellerEmail: "eka@example.com",
        travellerPhone: "0876634231987"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone: "+6281234567004"
      }
    });

    expect(created.inquiry.operatorPhone).toBe("6283333333333");
  }, 20_000);

  it("routes operator dispatches to the approved BluePass operator profile phone", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.BLUEPASS_APP_URL = "https://bluepass.co";
    process.env.BLUEPASS_APP_SERVICE_TOKEN = "bridge_secret";
    process.env.BLUEPASS_OPERATOR_PHONE_OVERRIDES = JSON.stringify({
      "calico-jack": "6283333333333"
    });

    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        operators: [
          {
            operatorSlug: "calico-jack",
            operatorName: "Calico Jack",
            yachtSlugs: ["calico-jack"],
            whatsappPhone: "6284444444444",
            status: "APPROVED",
            source: "operator_profile"
          }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const created = await createOrReuseBluePassInquiry({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      travellerMessage: "Calico Jack in Komodo for 4 guests in July",
      intent: {
        destination: "Komodo",
        dateWindow: "July 2026",
        guests: 4,
        travellerName: "Eka",
        travellerEmail: "eka@example.com",
        travellerPhone: "0876634231987"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone: "+6281234567004"
      }
    });

    expect(created.inquiry.operatorPhone).toBe("6284444444444");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://bluepass.co/api/kai/operator-directory",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer bridge_secret"
        })
      })
    );
  }, 20_000);

  it("resolves the operator profile phone from an existing selected yacht when confirmation lacks yacht text", async () => {
    process.env.BLUEPASS_APP_URL = "https://bluepass.co";
    process.env.BLUEPASS_APP_SERVICE_TOKEN = "bridge_secret";

    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        operators: [
          {
            operatorSlug: "calico-jack",
            operatorName: "Calico Jack",
            yachtSlugs: ["calico-jack"],
            whatsappPhone: "085337210180",
            status: "APPROVED",
            source: "operator_profile"
          }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const tenantId = `tenant_${randomUUID()}`;
    const conversationId = `conversation_${randomUUID()}`;
    const first = await createOrReuseBluePassInquiry({
      tenantId,
      conversationId,
      travellerMessage: "Calico Jack in Komodo for 3 guests in July",
      intent: {
        destination: "Komodo",
        dateWindow: "July 2026",
        guests: 3,
        travellerName: "Eka",
        travellerEmail: "eka@example.com",
        travellerPhone: "0876634231987"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone: null
      }
    });

    const confirmed = await createOrReuseBluePassInquiry({
      tenantId,
      conversationId,
      travellerMessage: "yes",
      intent: {
        destination: "Komodo",
        dateWindow: "July 2026",
        guests: 3,
        travellerName: "Eka",
        travellerEmail: "eka@example.com",
        travellerPhone: "0876634231987"
      },
      selectedYacht: null
    });

    expect(confirmed.reusedExisting).toBe(true);
    expect(confirmed.inquiry.id).toBe(first.inquiry.id);
    expect(confirmed.inquiry.selectedYachtSlug).toBe("calico-jack");
    expect(confirmed.inquiry.operatorPhone).toBe("085337210180");
  }, 20_000);

  it("sends the approved WhatsApp operator inquiry template when template mode is enabled", async () => {
    process.env.WHATSAPP_OPERATOR_INQUIRY_SEND_MODE = "template";
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_OPS = "1115079071692326";

    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        messages: [{ id: "wamid.operator_template" }]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const created = await createOrReuseBluePassInquiry({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
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
      }
    });

    const dispatch = await dispatchBluePassOperatorWhatsApp({
      inquiryId: created.inquiry.id
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v20.0/1115079071692326/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test_access_token",
          "Content-Type": "application/json"
        })
      })
    );
    const firstFetchCall = fetchMock.mock.calls[0];
    expect(firstFetchCall).toBeDefined();
    const requestInit = firstFetchCall?.[1] as RequestInit;
    const requestBody = JSON.parse(requestInit.body as string);
    expect(requestBody).toMatchObject({
      messaging_product: "whatsapp",
      to: "6281234567001",
      type: "template",
      template: {
        name: "booking_inquiry_operator",
        language: { code: "en" }
      }
    });
    expect(requestBody.template.components[0].parameters.map((param: { text: string }) => param.text)).toEqual([
      "Komodo / 8 guests",
      "Maya Chen",
      "+61 400 111 222",
      "next month",
      "8",
      "USD 10000",
      "Alila Purnama inquiry",
      "Selected yacht: alila-purnama"
    ]);
    expect(dispatch).toMatchObject({
      status: "SENT",
      providerMessageId: "wamid.operator_template",
      sentAt: expect.any(Date)
    });
  }, 20_000);

  it("marks operator dispatch failed instead of throwing when Meta rejects authentication", async () => {
    process.env.WHATSAPP_OPERATOR_INQUIRY_SEND_MODE = "template";
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "expired_access_token";
    process.env.WHATSAPP_PHONE_ID_OPS = "1115079071692326";

    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          error: {
            message: "Authentication Error",
            type: "OAuthException",
            code: 190,
            fbtrace_id: "trace"
          }
        },
        { status: 401 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const created = await createOrReuseBluePassInquiry({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
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
      }
    });

    const dispatch = await dispatchBluePassOperatorWhatsApp({
      inquiryId: created.inquiry.id
    });
    const status = await getActiveBluePassInquiryStatus({
      tenantId: created.inquiry.tenantId,
      conversationId: created.inquiry.conversationId
    });

    expect(dispatch).toMatchObject({
      status: "FAILED",
      providerMessageId: null,
      failureReason: expect.stringContaining("Authentication Error")
    });
    expect(status?.inquiry.status).toBe("READY_TO_DISPATCH");
  }, 20_000);

  it("lists BluePass inquiries for an admin tenant slug", async () => {
    const slug = `bluepass-admin-${randomUUID()}`;
    const tenant = await prisma.tenant.create({
      data: {
        slug,
        name: "BluePass Admin Test",
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: ["https://bluepass.co"],
        status: "ACTIVE"
      }
    });
    const conversationId = `conversation_${randomUUID()}`;
    const created = await createOrReuseBluePassInquiry({
      tenantId: tenant.id,
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
    await syncBluePassReferralLedgerEstimate(created.inquiry);
    await dispatchBluePassOperatorWhatsApp({ inquiryId: created.inquiry.id });

    const adminList = await listBluePassInquiriesForTenantSlug({ tenantSlug: slug });

    expect(adminList[0]).toMatchObject({
      id: created.inquiry.id,
      tenant: {
        slug,
        name: "BluePass Admin Test"
      },
      selectedYachtName: "Alila Purnama",
      status: "OPERATOR_PENDING"
    });
    expect(adminList[0].ledger).toHaveLength(4);
    expect(adminList[0].dispatches[0]).toMatchObject({
      status: "QUEUED",
      operatorPhone: "+6281234567001"
    });
  }, 20_000);

  it("accepts an operator response and notifies the traveller conversation", async () => {
    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-operator-accept-${randomUUID()}`,
        name: "BluePass Operator Accept Test",
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
    const created = await createOrReuseBluePassInquiry({
      tenantId: tenant.id,
      conversationId: conversation.id,
      travellerMessage: "Calico Jack in Komodo for 4 guests on 20 July 2026",
      intent: {
        destination: "Komodo",
        dateWindow: "20 July 2026",
        guests: 4,
        travellerName: "Ekap",
        travellerEmail: "ekap@example.com",
        travellerPhone: "0876634231987"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone: "+6281234567004"
      }
    });
    await dispatchBluePassOperatorWhatsApp({ inquiryId: created.inquiry.id });

    const result = await handleBluePassOperatorResponse({
      inquiryId: created.inquiry.id,
      action: "accept",
      providerMessageId: "wamid.button.accept",
      operatorPhone: "+6281234567004"
    });
    const messages = await prisma.message.findMany({
      where: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        role: "ASSISTANT"
      },
      orderBy: { createdAt: "asc" }
    });
    const status = await getActiveBluePassInquiryStatus({
      tenantId: tenant.id,
      conversationId: conversation.id
    });

    expect(result.inquiry).toMatchObject({
      id: created.inquiry.id,
      status: "OPERATOR_ACCEPTED"
    });
    expect(result.travellerNotification).toMatchObject({
      channel: "conversation",
      sent: true
    });
    expect(messages.at(-1)?.content).toContain("Calico Jack accepted");
    expect(messages.at(-1)?.content).toContain("Quote link: https://bluepass.co/quotes/");
    expect(status).toBeNull();
    const event = await prisma.bluePassInquiryEvent.findFirst({
      where: {
        bluePassInquiryId: created.inquiry.id,
        type: "OPERATOR_ACCEPTED"
      },
      orderBy: { createdAt: "desc" }
    });
    expect(event?.metadata).toMatchObject({
      providerMessageId: "wamid.button.accept"
    });
  }, 20_000);

  it("declines an operator response and tells the traveller BluePass will compare alternatives first", async () => {
    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-operator-decline-${randomUUID()}`,
        name: "BluePass Operator Decline Test",
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
    const created = await createOrReuseBluePassInquiry({
      tenantId: tenant.id,
      conversationId: conversation.id,
      travellerMessage: "Calico Jack in Komodo for 4 guests on 20 July 2026",
      intent: {
        destination: "Komodo",
        dateWindow: "20 July 2026",
        guests: 4,
        travellerName: "Ekap",
        travellerEmail: "ekap@example.com",
        travellerPhone: "0876634231987"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone: "+6281234567004"
      }
    });
    await dispatchBluePassOperatorWhatsApp({ inquiryId: created.inquiry.id });

    const result = await handleBluePassOperatorResponse({
      inquiryId: created.inquiry.id,
      action: "decline",
      providerMessageId: "wamid.button.decline"
    });
    const messages = await prisma.message.findMany({
      where: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        role: "ASSISTANT"
      },
      orderBy: { createdAt: "asc" }
    });

    expect(result.inquiry).toMatchObject({
      status: "DECLINED"
    });
    expect(messages.at(-1)?.content).toContain("Calico Jack is not available");
    expect(messages.at(-1)?.content).toContain("Similar BluePass options");
    expect(messages.at(-1)?.content).toContain("1. Alila Purnama");
    expect(messages.at(-1)?.content).toContain('Reply "try Alila Purnama"');
    expect(messages.at(-1)?.content).toContain("before BluePass dispatches");
  }, 20_000);

  it("records a counter-offer and notifies the traveller without recommending alternatives by default", async () => {
    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-operator-counter-${randomUUID()}`,
        name: "BluePass Operator Counter Test",
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
    const created = await createOrReuseBluePassInquiry({
      tenantId: tenant.id,
      conversationId: conversation.id,
      travellerMessage: "Calico Jack in Komodo for 4 guests on 20 July 2026",
      intent: {
        destination: "Komodo",
        dateWindow: "20 July 2026",
        guests: 4,
        travellerName: "Ekap",
        travellerEmail: "ekap@example.com",
        travellerPhone: "0876634231987"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone: "+6281234567004"
      }
    });
    await dispatchBluePassOperatorWhatsApp({ inquiryId: created.inquiry.id });

    const result = await handleBluePassOperatorResponse({
      inquiryId: created.inquiry.id,
      action: "counter",
      counterText: "Available 21 July instead at USD 48,000 private charter.",
      providerMessageId: "wamid.button.counter"
    });
    const messages = await prisma.message.findMany({
      where: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        role: "ASSISTANT"
      },
      orderBy: { createdAt: "asc" }
    });
    const event = await prisma.bluePassInquiryEvent.findFirst({
      where: {
        bluePassInquiryId: created.inquiry.id,
        type: "OPERATOR_COUNTER_OFFERED"
      },
      orderBy: { createdAt: "desc" }
    });

    expect(result.inquiry).toMatchObject({
      status: "COUNTER_OFFERED"
    });
    expect(messages.at(-1)?.content).toContain("Calico Jack sent a counter-offer");
    expect(messages.at(-1)?.content).toContain("21 July");
    expect(messages.at(-1)?.content).toContain("accept the counter");
    expect(messages.at(-1)?.content).not.toContain("2-3 similar alternatives");
    expect(event?.metadata).toMatchObject({
      counterText: "Available 21 July instead at USD 48,000 private charter."
    });
  }, 20_000);

  it("asks the operator for counter details before notifying the traveller", async () => {
    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-counter-details-${randomUUID()}`,
        name: "BluePass Counter Details Test",
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
    const created = await createOrReuseBluePassInquiry({
      tenantId: tenant.id,
      conversationId: conversation.id,
      travellerMessage: "Calico Jack in Komodo for 4 guests on 20 July 2026",
      intent: {
        destination: "Komodo",
        dateWindow: "20 July 2026",
        guests: 4,
        travellerName: "Ekap",
        travellerEmail: "ekap@example.com",
        travellerPhone: "0876634231987"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone: "+6281234567004"
      }
    });
    await dispatchBluePassOperatorWhatsApp({ inquiryId: created.inquiry.id });

    const result = await handleBluePassOperatorResponse({
      inquiryId: created.inquiry.id,
      action: "counter",
      providerMessageId: "wamid.button.counter",
      operatorPhone: "+6281234567004"
    });
    const messages = await prisma.message.findMany({
      where: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        role: "ASSISTANT"
      }
    });
    const event = await prisma.bluePassInquiryEvent.findFirst({
      where: {
        bluePassInquiryId: created.inquiry.id,
        type: "OPERATOR_COUNTER_DETAILS_REQUESTED"
      }
    });

    expect(result.inquiry).toMatchObject({
      status: "OPERATOR_PENDING"
    });
    expect(result.operatorFollowUp).toMatchObject({
      requested: true
    });
    expect(result.operatorFollowUp?.prompt).toContain("Suggested format:");
    expect(result.operatorFollowUp?.prompt).not.toContain(`counter:${created.inquiry.id}`);
    expect(messages).toEqual([]);
    expect(event?.metadata).toMatchObject({
      providerMessageId: "wamid.button.counter"
    });
  }, 20_000);

  it("sends the traveller WhatsApp notification by default when Kai WhatsApp credentials are present", async () => {
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";

    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        messages: [{ id: "wamid.traveller.accept" }]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-traveller-whatsapp-${randomUUID()}`,
        name: "BluePass Traveller WhatsApp Test",
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
    const created = await createOrReuseBluePassInquiry({
      tenantId: tenant.id,
      conversationId: conversation.id,
      travellerMessage: "Calico Jack in Komodo for 4 guests on 20 July 2026",
      intent: {
        destination: "Komodo",
        dateWindow: "20 July 2026",
        guests: 4,
        travellerName: "Ekap",
        travellerEmail: "ekap@example.com",
        travellerPhone: "0876634231987"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone: "+6281234567004"
      }
    });

    const result = await handleBluePassOperatorResponse({
      inquiryId: created.inquiry.id,
      action: "accept",
      providerMessageId: "wamid.button.accept"
    });
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const requestBody = JSON.parse(String(requestInit.body));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v20.0/1115079071692326/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test_access_token"
        })
      })
    );
    expect(requestBody).toMatchObject({
      messaging_product: "whatsapp",
      to: "0876634231987",
      type: "text"
    });
    expect(requestBody.text.body).toContain("Calico Jack accepted");
    expect(result.travellerNotification).toMatchObject({
      channel: "whatsapp",
      sent: true,
      providerMessageId: "wamid.traveller.accept"
    });
  }, 20_000);

  it("sends traveller WhatsApp notifications with the approved template when configured", async () => {
    process.env.WHATSAPP_TRAVELLER_NOTIFY_SEND_MODE = "template";
    process.env.WHATSAPP_TRAVELLER_UPDATE_TEMPLATE = "bluepass_inquiry_update";
    process.env.WHATSAPP_TRAVELLER_UPDATE_TEMPLATE_LANGUAGE = "en";
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";

    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        messages: [{ id: "wamid.traveller.template.accept" }]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-traveller-template-${randomUUID()}`,
        name: "BluePass Traveller Template Test",
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
    const created = await createOrReuseBluePassInquiry({
      tenantId: tenant.id,
      conversationId: conversation.id,
      travellerMessage: "Calico Jack in Komodo for 4 guests on 24 July",
      intent: {
        destination: "Komodo",
        dateWindow: "24 July",
        guests: 4,
        travellerName: "Inov Afani",
        travellerEmail: "inov@example.com",
        travellerPhone: "085156246329"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone: "+6281234567004"
      }
    });

    const result = await handleBluePassOperatorResponse({
      inquiryId: created.inquiry.id,
      action: "accept",
      providerMessageId: "wamid.button.accept"
    });
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const requestBody = JSON.parse(String(requestInit.body));

    expect(requestBody).toMatchObject({
      messaging_product: "whatsapp",
      to: "085156246329",
      type: "template",
      template: {
        name: "bluepass_inquiry_update",
        language: { code: "en" }
      }
    });
    expect(requestBody.template.components[0].parameters.map((param: { text: string }) => param.text)).toEqual([
      "Inov Afani",
      "Komodo / 24 July / 4 guests",
      "Calico Jack",
      expect.stringContaining("Accepted by operator. Quote: https://bluepass.co/quotes/")
    ]);
    expect(result.travellerNotification).toMatchObject({
      channel: "whatsapp",
      sent: true,
      providerMessageId: "wamid.traveller.template.accept"
    });
  }, 20_000);

  it("falls back to the traveller template when Meta blocks a free-text re-engagement message", async () => {
    process.env.WHATSAPP_TRAVELLER_NOTIFY_SEND_MODE = "text";
    process.env.WHATSAPP_TRAVELLER_UPDATE_TEMPLATE = "bluepass_inquiry_update";
    process.env.WHATSAPP_TRAVELLER_UPDATE_TEMPLATE_LANGUAGE = "en";
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              message: "Message failed to send because more than 24 hours have passed.",
              type: "OAuthException",
              code: 131047,
              fbtrace_id: "trace_reengagement"
            }
          },
          { status: 400 }
        )
      )
      .mockResolvedValueOnce(
        Response.json({
          messages: [{ id: "wamid.traveller.template.decline" }]
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-traveller-template-fallback-${randomUUID()}`,
        name: "BluePass Traveller Template Fallback Test",
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
    const created = await createOrReuseBluePassInquiry({
      tenantId: tenant.id,
      conversationId: conversation.id,
      travellerMessage: "Calico Jack in Komodo for 3 guests on 10 July",
      intent: {
        destination: "Komodo",
        dateWindow: "10 July",
        guests: 3,
        travellerName: "Inov",
        travellerEmail: "inov@example.com",
        travellerPhone: "085156246329"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone: "+6281234567004"
      }
    });

    const result = await handleBluePassOperatorResponse({
      inquiryId: created.inquiry.id,
      action: "decline",
      providerMessageId: "wamid.button.decline"
    });
    const textRequest = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    const templateRequest = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    const event = await prisma.bluePassInquiryEvent.findFirst({
      where: {
        bluePassInquiryId: created.inquiry.id,
        type: "TRAVELLER_WHATSAPP_NOTIFICATION_SENT"
      },
      orderBy: { createdAt: "desc" }
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(textRequest.type).toBe("text");
    expect(templateRequest).toMatchObject({
      messaging_product: "whatsapp",
      to: "085156246329",
      type: "template",
      template: {
        name: "bluepass_inquiry_update",
        language: { code: "en" }
      }
    });
    expect(templateRequest.template.components[0].parameters.map((param: { text: string }) => param.text)).toEqual([
      "Inov",
      "Komodo / 10 July / 3 guests",
      "Calico Jack",
      expect.stringContaining("Similar options: Alila Purnama")
    ]);
    expect(event?.metadata).toMatchObject({
      providerMessageId: "wamid.traveller.template.decline",
      messageType: "template",
      templateName: "bluepass_inquiry_update",
      fallbackFrom: "text"
    });
    expect(result.travellerNotification).toMatchObject({
      channel: "whatsapp",
      sent: true,
      providerMessageId: "wamid.traveller.template.decline"
    });
  }, 20_000);

  it("records payment-ready operator details after traveller approval and notifies the traveller", async () => {
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

    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-payment-ready-${randomUUID()}`,
        name: "BluePass Payment Ready Test",
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
    const created = await createOrReuseBluePassInquiry({
      tenantId: tenant.id,
      conversationId: conversation.id,
      travellerMessage: "Calico Jack in Komodo for 2 guests on 20 July",
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
    await dispatchBluePassOperatorWhatsApp({ inquiryId: created.inquiry.id });
    await handleBluePassOperatorResponse({
      inquiryId: created.inquiry.id,
      action: "counter",
      counterText:
        "Available 22 July 2026. Final price USD 3,900 per cabin/night for 2 guests. Includes full board meals. Excludes flights. Condition: 30% deposit to hold."
    });
    await approveBluePassQuote({ quoteId: created.inquiry.id });
    fetchMock.mockClear();

    const result = await handleBluePassOperatorResponse({
      inquiryId: created.inquiry.id,
      action: "payment_ready",
      counterText:
        "Slot held for 22 July. Payment link: https://pay.example/cj-22. Deposit 30% due today. Booking reference CJ-2207.",
      providerMessageId: "wamid.operator.payment_ready",
      operatorPhone: "6285337210180"
    });
    const event = await prisma.bluePassInquiryEvent.findFirst({
      where: {
        bluePassInquiryId: created.inquiry.id,
        type: "OPERATOR_PAYMENT_READY"
      },
      orderBy: { createdAt: "desc" }
    });
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const requestBody = JSON.parse(String(requestInit.body));

    expect(result.inquiry).toMatchObject({
      id: created.inquiry.id,
      status: "COUNTER_OFFERED"
    });
    expect(event?.metadata).toMatchObject({
      providerMessageId: "wamid.operator.payment_ready",
      operatorPhone: "6285337210180",
      paymentText:
        "Slot held for 22 July. Payment link: https://pay.example/cj-22. Deposit 30% due today. Booking reference CJ-2207."
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestBody).toMatchObject({
      to: "085156246329",
      type: "text"
    });
    expect(requestBody.text.body).toContain("Calico Jack has held your BluePass trip");
    expect(requestBody.text.body).toContain("https://pay.example/cj-22");
    expect(requestBody.text.body).toContain("not a confirmed booking until payment");
  }, 50_000);

  it("records booking confirmation from the operator and notifies the traveller", async () => {
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

    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-booking-confirmed-${randomUUID()}`,
        name: "BluePass Booking Confirmed Test",
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
    const created = await createOrReuseBluePassInquiry({
      tenantId: tenant.id,
      conversationId: conversation.id,
      travellerMessage: "Calico Jack in Komodo for 2 guests on 20 July",
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
    await dispatchBluePassOperatorWhatsApp({ inquiryId: created.inquiry.id });
    await handleBluePassOperatorResponse({
      inquiryId: created.inquiry.id,
      action: "counter",
      counterText:
        "Available 22 July 2026. Final price USD 3,900 per cabin/night for 2 guests. Includes full board meals. Excludes flights. Condition: 30% deposit to hold."
    });
    await approveBluePassQuote({ quoteId: created.inquiry.id });
    await handleBluePassOperatorResponse({
      inquiryId: created.inquiry.id,
      action: "payment_ready",
      counterText:
        "Slot held for 22 July. Payment link: https://pay.example/cj-22. Deposit 30% due today. Booking reference CJ-2207."
    });
    fetchMock.mockClear();

    const result = await handleBluePassOperatorResponse({
      inquiryId: created.inquiry.id,
      action: "booking_confirmed",
      counterText: "Payment received. Booking confirmed for 22 July. Booking reference CJ-2207.",
      providerMessageId: "wamid.operator.booking_confirmed",
      operatorPhone: "6285337210180"
    });
    const event = await prisma.bluePassInquiryEvent.findFirst({
      where: {
        bluePassInquiryId: created.inquiry.id,
        type: "OPERATOR_BOOKING_CONFIRMED"
      },
      orderBy: { createdAt: "desc" }
    });
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const requestBody = JSON.parse(String(requestInit.body));

    expect(result.inquiry).toMatchObject({
      id: created.inquiry.id,
      status: "CLOSED"
    });
    expect(event?.metadata).toMatchObject({
      providerMessageId: "wamid.operator.booking_confirmed",
      operatorPhone: "6285337210180",
      confirmationText: "Payment received. Booking confirmed for 22 July. Booking reference CJ-2207."
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestBody).toMatchObject({
      to: "085156246329",
      type: "text"
    });
    expect(requestBody.text.body).toContain("Your BluePass booking with Calico Jack is confirmed");
    expect(requestBody.text.body).toContain("CJ-2207");
  }, 30_000);

  it("resolves text-only operator actions to the newest pending dispatch for that operator", async () => {
    process.env.WHATSAPP_OPERATOR_INQUIRY_SEND_MODE = "template";
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_OPS = "1115079071692326";

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json({
          messages: [{ id: `wamid.${randomUUID()}` }]
        })
      )
    );

    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-text-resolve-${randomUUID()}`,
        name: "BluePass Text Resolve Test",
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: ["https://bluepass.co"],
        status: "ACTIVE"
      }
    });
    const olderConversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        channel: "WEB_WIDGET"
      }
    });
    const newerConversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        channel: "WEB_WIDGET"
      }
    });
    const operatorPhone = "6285337210180";
    const older = await createOrReuseBluePassInquiry({
      tenantId: tenant.id,
      conversationId: olderConversation.id,
      travellerMessage: "Older Calico Jack inquiry",
      intent: {
        destination: "Komodo",
        dateWindow: "5 July 2026",
        guests: 2,
        travellerName: "Old",
        travellerEmail: "old@example.com",
        travellerPhone: "085100000001"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorPhone
      }
    });
    await prisma.bluePassOperatorDispatch.create({
      data: {
        tenantId: tenant.id,
        conversationId: older.inquiry.conversationId,
        bluePassInquiryId: older.inquiry.id,
        status: "QUEUED",
        operatorPhone,
        outboundText: "old queued dispatch"
      }
    });

    const newer = await createOrReuseBluePassInquiry({
      tenantId: tenant.id,
      conversationId: newerConversation.id,
      travellerMessage: "Newer Calico Jack inquiry",
      intent: {
        destination: "Komodo",
        dateWindow: "6 July 2026",
        guests: 4,
        travellerName: "New",
        travellerEmail: "new@example.com",
        travellerPhone: "085100000002"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorPhone
      }
    });
    await dispatchBluePassOperatorWhatsApp({ inquiryId: newer.inquiry.id });

    await handleBluePassOperatorResponse({
      inquiryId: older.inquiry.id,
      action: "accept",
      providerMessageId: "manual.old.accept"
    });

    await expect(resolveLatestPendingBluePassInquiryIdForOperatorPhone(operatorPhone)).resolves.toBe(newer.inquiry.id);
  }, 20_000);
});
