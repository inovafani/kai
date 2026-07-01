import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOrReuseBluePassInquiry, dispatchBluePassOperatorWhatsApp } from "@/server/bluepass/bluepass-inquiry-repository";
import { prisma } from "@/lib/prisma";
import { GET, POST } from "./route";

const originalEnv = { ...process.env };
const isolatedWhatsAppEnvKeys = [
  "BLUEPASS_TEST_OPERATOR_PHONE",
  "WHATSAPP_OPERATOR_INQUIRY_SEND_MODE",
  "WHATSAPP_TRAVELLER_NOTIFY_SEND_MODE",
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
});

describe("/api/whatsapp/webhook", () => {
  it("verifies the Meta webhook challenge with the configured token", async () => {
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "verify_secret";

    const response = await GET(
      new Request(
        "http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify_secret&hub.challenge=challenge_123"
      )
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("challenge_123");
  });

  it("handles an operator accept button callback", async () => {
    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-webhook-${randomUUID()}`,
        name: "BluePass Webhook Test",
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

    const response = await POST(
      new Request("http://localhost/api/whatsapp/webhook", {
        method: "POST",
        body: JSON.stringify({
          entry: [
            {
              changes: [
                {
                  value: {
                    messages: [
                      {
                        from: "6285337210180",
                        id: "wamid.operator.accept",
                        type: "interactive",
                        interactive: {
                          type: "button_reply",
                          button_reply: {
                            id: `accept:${created.inquiry.id}`,
                            title: "Accept"
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          ]
        })
      })
    );
    const body = await response.json();
    const inquiry = await prisma.bluePassInquiry.findUniqueOrThrow({
      where: { id: created.inquiry.id }
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      handled: 1
    });
    expect(inquiry.status).toBe("OPERATOR_ACCEPTED");
  }, 20_000);

  it("resolves a text-only operator accept button to the latest pending dispatch", async () => {
    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-webhook-text-only-${randomUUID()}`,
        name: "BluePass Webhook Text Button Test",
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
      travellerMessage: "Calico Jack in Komodo for 4 guests on 6 July 2026",
      intent: {
        destination: "Komodo",
        dateWindow: "6 July 2026",
        guests: 4,
        travellerName: "Inova",
        travellerEmail: "inova@example.com",
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

    const response = await POST(
      new Request("http://localhost/api/whatsapp/webhook", {
        method: "POST",
        body: JSON.stringify({
          entry: [
            {
              changes: [
                {
                  value: {
                    messages: [
                      {
                        from: "6285337210180",
                        id: "wamid.operator.accept_text",
                        type: "button",
                        button: {
                          text: "Accept"
                        }
                      }
                    ]
                  }
                }
              ]
            }
          ]
        })
      })
    );
    const body = await response.json();
    const inquiry = await prisma.bluePassInquiry.findUniqueOrThrow({
      where: { id: created.inquiry.id }
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      handled: 1,
      failed: 0
    });
    expect(inquiry.status).toBe("OPERATOR_ACCEPTED");
  }, 20_000);

  it("acknowledges unknown inquiry callbacks without making Meta retry the webhook", async () => {
    const response = await POST(
      new Request("http://localhost/api/whatsapp/webhook", {
        method: "POST",
        body: JSON.stringify({
          entry: [
            {
              changes: [
                {
                  value: {
                    messages: [
                      {
                        from: "6285337210180",
                        id: "wamid.operator.unknown",
                        type: "interactive",
                        interactive: {
                          type: "button_reply",
                          button_reply: {
                            id: "accept:missing_inquiry",
                            title: "Accept"
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          ]
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      handled: 0,
      failed: 1
    });
  });
});
