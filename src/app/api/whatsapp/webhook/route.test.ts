import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOrReuseBluePassInquiry,
  dispatchBluePassOperatorWhatsApp,
  handleBluePassOperatorResponse
} from "@/server/bluepass/bluepass-inquiry-repository";
import { approveBluePassQuote } from "@/server/bluepass/bluepass-quote";
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
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_BLUEPASS_TENANT_SLUG",
  "ENABLE_LLM",
  "LLM_PROVIDER",
  "OPENAI_API_KEY"
];

beforeEach(() => {
  for (const key of isolatedWhatsAppEnvKeys) {
    delete process.env[key];
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    const operatorPhone = "+6281234567004";
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
        operatorPhone
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
                        from: operatorPhone,
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
    const operatorPhone = "6285337211180";
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
        operatorPhone
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
                        from: operatorPhone,
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

  it("resolves natural operator payment details to the latest approved quote inquiry", async () => {
    const operatorPhone = "6285337211181";
    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-webhook-payment-ready-${randomUUID()}`,
        name: "BluePass Webhook Payment Ready Test",
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
        operatorPhone
      }
    });
    await dispatchBluePassOperatorWhatsApp({ inquiryId: created.inquiry.id });
    await prisma.bluePassInquiry.update({
      where: { id: created.inquiry.id },
      data: { status: "COUNTER_OFFERED" }
    });
    await prisma.bluePassInquiryEvent.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        bluePassInquiryId: created.inquiry.id,
        type: "BLUEPASS_QUOTE_DRAFTED",
        fromStatus: "COUNTER_OFFERED",
        toStatus: "COUNTER_OFFERED",
        metadata: {
          id: created.inquiry.id,
          inquiryId: created.inquiry.id,
          status: "READY_FOR_TRAVELLER",
          selectedYachtName: "Calico Jack",
          operatorName: "Calico Jack",
          destination: "Komodo",
          dateWindow: "22 July",
          guests: 2,
          currency: "USD",
          grossPriceCents: 390000,
          conservationContributionCents: 19500,
          inclusions: "full board meals",
          exclusions: "flights",
          terms: "30% deposit",
          source: "operator_counter",
          quoteUrl: `https://bluepass.co/quotes/${created.inquiry.id}`
        }
      }
    });
    await approveBluePassQuote({ quoteId: created.inquiry.id });

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
                        from: operatorPhone,
                        id: "wamid.operator.payment_ready",
                        type: "text",
                        text: {
                          body: "Slot held for 22 July. Payment link: https://pay.example/cj-22. Deposit 30% due today. Booking reference CJ-2207."
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
    const event = await prisma.bluePassInquiryEvent.findFirst({
      where: {
        bluePassInquiryId: created.inquiry.id,
        type: "OPERATOR_PAYMENT_READY"
      }
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      handled: 1,
      failed: 0
    });
    expect(event?.metadata).toMatchObject({
      providerMessageId: "wamid.operator.payment_ready",
      paymentText:
        "Slot held for 22 July. Payment link: https://pay.example/cj-22. Deposit 30% due today. Booking reference CJ-2207."
    });
  }, 20_000);

  it("resolves natural operator booking confirmation to the latest inquiry", async () => {
    const operatorPhone = "6285337211182";
    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-webhook-booking-confirmed-${randomUUID()}`,
        name: "BluePass Webhook Booking Confirmed Test",
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
        operatorPhone
      }
    });
    await dispatchBluePassOperatorWhatsApp({ inquiryId: created.inquiry.id });
    await prisma.bluePassInquiry.update({
      where: { id: created.inquiry.id },
      data: { status: "COUNTER_OFFERED" }
    });
    await prisma.bluePassInquiryEvent.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        bluePassInquiryId: created.inquiry.id,
        type: "OPERATOR_PAYMENT_READY",
        fromStatus: "COUNTER_OFFERED",
        toStatus: "COUNTER_OFFERED",
        metadata: {
          paymentText: "Slot held. Payment link: https://pay.example/cj-22."
        }
      }
    });

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
                        from: operatorPhone,
                        id: "wamid.operator.booking_confirmed",
                        type: "text",
                        text: {
                          body: "Payment received. Booking confirmed for 22 July. Booking reference CJ-2207."
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
    const event = await prisma.bluePassInquiryEvent.findFirst({
      where: {
        bluePassInquiryId: created.inquiry.id,
        type: "OPERATOR_BOOKING_CONFIRMED"
      }
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      handled: 1,
      failed: 0
    });
    expect(inquiry.status).toBe("CLOSED");
    expect(event?.metadata).toMatchObject({
      providerMessageId: "wamid.operator.booking_confirmed",
      confirmationText: "Payment received. Booking confirmed for 22 July. Booking reference CJ-2207."
    });
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

  it("records traveller WhatsApp delivery statuses from Meta callbacks", async () => {
    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-whatsapp-status-${randomUUID()}`,
        name: "BluePass WhatsApp Status Test",
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
    await prisma.bluePassInquiryEvent.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        bluePassInquiryId: created.inquiry.id,
        type: "TRAVELLER_WHATSAPP_NOTIFICATION_SENT",
        fromStatus: created.inquiry.status,
        toStatus: created.inquiry.status,
        metadata: {
          providerMessageId: "wamid.traveller.status"
        }
      }
    });

    const response = await POST(
      new Request("http://localhost/api/whatsapp/webhook", {
        method: "POST",
        body: JSON.stringify({
          entry: [
            {
              changes: [
                {
                  value: {
                    statuses: [
                      {
                        id: "wamid.traveller.status",
                        status: "failed",
                        timestamp: "1780000000",
                        recipient_id: "6285156246329",
                        errors: [
                          {
                            code: 131026,
                            title: "Message undeliverable",
                            message: "Message was not delivered.",
                            error_data: {
                              details: "Recipient phone number is not in the allowed list."
                            }
                          }
                        ]
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
    const event = await prisma.bluePassInquiryEvent.findFirst({
      where: {
        bluePassInquiryId: created.inquiry.id,
        type: "TRAVELLER_WHATSAPP_DELIVERY_STATUS"
      },
      orderBy: { createdAt: "desc" }
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      statusesHandled: 1,
      statusesFailed: 0
    });
    expect(event?.metadata).toMatchObject({
      providerMessageId: "wamid.traveller.status",
      status: "failed",
      recipientId: "6285156246329",
      errors: [
        {
          code: 131026,
          title: "Message undeliverable",
          message: "Message was not delivered.",
          details: "Recipient phone number is not in the allowed list."
        }
      ]
    });
  }, 20_000);

  it("resends a traveller update template when Meta reports a text re-engagement failure", async () => {
    process.env.WHATSAPP_TRAVELLER_UPDATE_TEMPLATE = "bluepass_inquiry_update";
    process.env.WHATSAPP_TRAVELLER_UPDATE_TEMPLATE_LANGUAGE = "en";
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";

    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        messages: [{ id: "wamid.traveller.template.fallback" }]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-whatsapp-reengagement-${randomUUID()}`,
        name: "BluePass WhatsApp Reengagement Test",
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
        operatorPhone: "6285337210180"
      }
    });
    const declined = await prisma.bluePassInquiry.update({
      where: { id: created.inquiry.id },
      data: { status: "DECLINED" }
    });
    await prisma.bluePassInquiryEvent.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        bluePassInquiryId: declined.id,
        type: "TRAVELLER_WHATSAPP_NOTIFICATION_SENT",
        fromStatus: declined.status,
        toStatus: declined.status,
        metadata: {
          providerMessageId: "wamid.traveller.text.failed",
          messageType: "text",
          templateName: null
        }
      }
    });

    const response = await POST(
      new Request("http://localhost/api/whatsapp/webhook", {
        method: "POST",
        body: JSON.stringify({
          entry: [
            {
              changes: [
                {
                  value: {
                    statuses: [
                      {
                        id: "wamid.traveller.text.failed",
                        status: "failed",
                        timestamp: "1780000000",
                        recipient_id: "6285156246329",
                        errors: [
                          {
                            code: 131047,
                            title: "Re-engagement message",
                            message: "Re-engagement message",
                            error_data: {
                              details:
                                "Message failed to send because more than 24 hours have passed since the customer last replied to this number."
                            }
                          }
                        ]
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
    const templateFetchCall = fetchMock.mock.calls.find((call) => Boolean((call[1] as RequestInit | undefined)?.body));
    const templateRequest = JSON.parse(String((templateFetchCall?.[1] as RequestInit).body));
    const fallbackEvent = await prisma.bluePassInquiryEvent.findFirst({
      where: {
        bluePassInquiryId: declined.id,
        type: "TRAVELLER_WHATSAPP_NOTIFICATION_SENT"
      },
      orderBy: { createdAt: "desc" }
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      statusesHandled: 1,
      statusesFailed: 0
    });
    expect(templateRequest).toMatchObject({
      messaging_product: "whatsapp",
      to: "6285156246329",
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
    expect(fallbackEvent?.metadata).toMatchObject({
      providerMessageId: "wamid.traveller.template.fallback",
      messageType: "template",
      templateName: "bluepass_inquiry_update",
      fallbackFrom: "delivery_status_131047"
    });
  }, 20_000);

  it("answers traveller WhatsApp status questions from the latest BluePass inquiry context", async () => {
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";

    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        messages: [{ id: "wamid.context.reply" }]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-whatsapp-context-${randomUUID()}`,
        name: "BluePass WhatsApp Context Test",
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
    await prisma.bluePassInquiry.update({
      where: { id: created.inquiry.id },
      data: { status: "COUNTER_OFFERED" }
    });
    await prisma.bluePassInquiryEvent.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        bluePassInquiryId: created.inquiry.id,
        type: "OPERATOR_PAYMENT_READY",
        fromStatus: "COUNTER_OFFERED",
        toStatus: "COUNTER_OFFERED",
        metadata: {
          paymentText: "Slot held for 22 July. Payment link: https://pay.example/cj-22."
        }
      }
    });

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
                        from: "6285156246329",
                        id: "wamid.traveller.context",
                        type: "text",
                        text: {
                          body: "what is my booking status?"
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
    const requestBody = JSON.parse(String((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body));
    const messages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" }
    });
    const contextEvent = await prisma.bluePassInquiryEvent.findFirst({
      where: {
        bluePassInquiryId: created.inquiry.id,
        type: "WHATSAPP_CONTEXT_REPLY_SENT"
      }
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      contextHandled: 1,
      contextFailed: 0
    });
    expect(requestBody).toMatchObject({
      messaging_product: "whatsapp",
      to: "6285156246329",
      type: "text"
    });
    expect(requestBody.text.body).toContain("Calico Jack");
    expect(requestBody.text.body).toContain("payment");
    expect(requestBody.text.body).toContain("https://pay.example/cj-22");
    expect(messages.map((message) => message.role)).toEqual(["TRAVELLER", "ASSISTANT"]);
    expect(contextEvent?.metadata).toMatchObject({
      participant: "traveller",
      providerMessageId: "wamid.context.reply"
    });
  }, 20_000);

  it("routes new traveller booking intents to WhatsApp marketplace instead of the latest inquiry context", async () => {
    process.env.BLUEPASS_TEST_OPERATOR_PHONE = "6285337210180";
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";

    const tenantSlug = `bluepass-whatsapp-new-intent-${randomUUID()}`;
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = tenantSlug;
    const inboundPhone = "6285156246329";

    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        messages: [{ id: "wamid.new.intent.reply" }]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const tenant = await prisma.tenant.create({
      data: {
        slug: tenantSlug,
        name: "BluePass WhatsApp New Intent Test",
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: ["https://bluepass.co"],
        status: "ACTIVE",
        config: {
          create: {
            supportedChannels: ["WEB_WIDGET", "WHATSAPP"],
            enabledFeatures: ["widget_config", "bluepass_marketplace", "operator_whatsapp_dispatch"],
            requiredSlots: {},
            bookingMode: "MANUAL_INQUIRY",
            bookingWriteEnabled: false,
            pmsProvider: "MOCK",
            escalationRules: [],
            responseGuardrails: [
              "Do not confirm availability, final price, payment, or booking before operator confirmation."
            ]
          }
        }
      }
    });
    const oldConversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        channel: "WEB_WIDGET"
      }
    });
    const old = await createOrReuseBluePassInquiry({
      tenantId: tenant.id,
      conversationId: oldConversation.id,
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
    await prisma.bluePassInquiry.update({
      where: { id: old.inquiry.id },
      data: { status: "COUNTER_OFFERED" }
    });
    await prisma.bluePassInquiryEvent.create({
      data: {
        tenantId: tenant.id,
        conversationId: oldConversation.id,
        bluePassInquiryId: old.inquiry.id,
        type: "OPERATOR_PAYMENT_READY",
        fromStatus: "COUNTER_OFFERED",
        toStatus: "COUNTER_OFFERED",
        metadata: {
          paymentText: "Slot held for 22 July. Payment link: https://pay.example/cj-22."
        }
      }
    });

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
                        from: inboundPhone,
                        id: "wamid.traveller.new.intent",
                        type: "text",
                        text: {
                          body: "I want to order Alila Purnama in Komodo for 2 guests on 10 July 2026"
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
    const requestBody = JSON.parse(String((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body));
    const marketplaceConversation = await prisma.conversation.findFirstOrThrow({
      where: {
        tenantId: tenant.id,
        channel: "WHATSAPP",
        travellerId: inboundPhone
      },
      include: {
        messages: { orderBy: { createdAt: "asc" } }
      }
    });
    const oldConversationMessages = await prisma.message.findMany({
      where: { conversationId: oldConversation.id }
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      contextHandled: 1,
      contextFailed: 0
    });
    expect(requestBody.text.body).toContain("Alila Purnama");
    expect(requestBody.text.body).not.toContain("https://pay.example/cj-22");
    expect(marketplaceConversation.messages.map((message) => message.role)).toEqual(["TRAVELLER", "ASSISTANT"]);
    expect(oldConversationMessages).toHaveLength(0);
  }, 20_000);

  it("routes traveller recommendation requests to marketplace instead of latest inquiry status", async () => {
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";

    const tenantSlug = `bluepass-whatsapp-recommendation-${randomUUID()}`;
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = tenantSlug;
    const inboundPhone = "6285156246329";

    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        messages: [{ id: "wamid.recommendation.reply" }]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const tenant = await prisma.tenant.create({
      data: {
        slug: tenantSlug,
        name: "BluePass WhatsApp Recommendation Test",
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: ["https://bluepass.co"],
        status: "ACTIVE",
        config: {
          create: {
            supportedChannels: ["WEB_WIDGET", "WHATSAPP"],
            enabledFeatures: ["widget_config", "bluepass_marketplace", "operator_whatsapp_dispatch"],
            requiredSlots: {},
            bookingMode: "MANUAL_INQUIRY",
            bookingWriteEnabled: false,
            pmsProvider: "MOCK",
            escalationRules: [],
            responseGuardrails: [
              "Do not confirm availability, final price, payment, or booking before operator confirmation."
            ]
          }
        }
      }
    });
    const whatsappConversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        channel: "WHATSAPP",
        travellerId: inboundPhone
      }
    });
    await createOrReuseBluePassInquiry({
      tenantId: tenant.id,
      conversationId: whatsappConversation.id,
      travellerMessage: "Alila Purnama in Komodo for 2 guests on 13 July 2026",
      intent: {
        destination: "Komodo",
        dateWindow: "13 July 2026",
        guests: 2,
        travellerName: "Putro",
        travellerEmail: "putro@example.com",
        travellerPhone: "085156246329"
      },
      selectedYacht: {
        slug: "alila-purnama",
        name: "Alila Purnama",
        operatorId: "operator_alila_purnama",
        operatorName: "Alila Purnama",
        operatorPhone: "6285337210180"
      }
    });

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
                        from: inboundPhone,
                        id: "wamid.traveller.recommendation",
                        type: "text",
                        text: {
                          body: "do you have recommendation for me in komodo?"
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
    const requestBody = JSON.parse(String((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body));
    const messages = await prisma.message.findMany({
      where: { conversationId: whatsappConversation.id },
      orderBy: { createdAt: "asc" }
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      contextHandled: 1,
      contextFailed: 0
    });
    expect(requestBody.text.body).toContain("Komodo");
    expect(requestBody.text.body).not.toContain("Current status");
    expect(requestBody.text.body).not.toContain("Operator Pending");
    expect(messages.map((message) => message.role)).toEqual(["TRAVELLER", "ASSISTANT"]);
  }, 20_000);

  it("routes general BluePass questions to concierge knowledge instead of latest inquiry status", async () => {
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";

    const tenantSlug = `bluepass-whatsapp-general-question-${randomUUID()}`;
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = tenantSlug;
    const inboundPhone = "6285156246329";

    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        messages: [{ id: "wamid.general.question.reply" }]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const tenant = await prisma.tenant.create({
      data: {
        slug: tenantSlug,
        name: "BluePass WhatsApp General Question Test",
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: ["https://bluepass.co"],
        status: "ACTIVE",
        config: {
          create: {
            supportedChannels: ["WEB_WIDGET", "WHATSAPP"],
            enabledFeatures: ["widget_config", "bluepass_marketplace", "operator_whatsapp_dispatch"],
            requiredSlots: {},
            bookingMode: "MANUAL_INQUIRY",
            bookingWriteEnabled: false,
            pmsProvider: "MOCK",
            escalationRules: [],
            responseGuardrails: [
              "Do not confirm availability, final price, payment, or booking before operator confirmation."
            ]
          }
        }
      }
    });
    const whatsappConversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        channel: "WHATSAPP",
        travellerId: inboundPhone
      }
    });
    await createOrReuseBluePassInquiry({
      tenantId: tenant.id,
      conversationId: whatsappConversation.id,
      travellerMessage: "Alila Purnama in Komodo for 2 guests on 13 July 2026",
      intent: {
        destination: "Komodo",
        dateWindow: "13 July 2026",
        guests: 2,
        travellerName: "Putro",
        travellerEmail: "putro@example.com",
        travellerPhone: "085156246329"
      },
      selectedYacht: {
        slug: "alila-purnama",
        name: "Alila Purnama",
        operatorId: "operator_alila_purnama",
        operatorName: "Alila Purnama",
        operatorPhone: "6285337210180"
      }
    });

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
                        from: inboundPhone,
                        id: "wamid.traveller.general.question",
                        type: "text",
                        text: {
                          body: "what is bluepass?"
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
    const requestBody = JSON.parse(String((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body));

    expect(response.status).toBe(200);
    expect(requestBody.text.body).toContain("BluePass helps travellers");
    expect(requestBody.text.body).not.toContain("Current status");
    expect(requestBody.text.body).not.toContain("Operator Pending");
  }, 20_000);

  it("uses the LLM rewrite layer for traveller WhatsApp marketplace questions", async () => {
    process.env.ENABLE_LLM = "true";
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";

    const tenantSlug = `bluepass-whatsapp-marketplace-llm-${randomUUID()}`;
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = tenantSlug;
    const inboundPhone = "6285156246329";

    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes("api.openai.com")) {
        return Response.json({
          output_text:
            "BluePass is your ocean-travel concierge for vetted liveaboards and marine trips. I can explain destinations, compare yachts, and prepare operator inquiries without pretending availability or payment is confirmed."
        });
      }

      return Response.json({
        messages: [{ id: "wamid.marketplace.llm.reply" }]
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await prisma.tenant.create({
      data: {
        slug: tenantSlug,
        name: "BluePass WhatsApp Marketplace LLM Test",
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: ["https://bluepass.co"],
        status: "ACTIVE",
        config: {
          create: {
            supportedChannels: ["WEB_WIDGET", "WHATSAPP"],
            enabledFeatures: ["widget_config", "bluepass_marketplace", "operator_whatsapp_dispatch"],
            requiredSlots: {},
            bookingMode: "MANUAL_INQUIRY",
            bookingWriteEnabled: false,
            pmsProvider: "MOCK",
            escalationRules: [],
            responseGuardrails: [
              "Do not confirm availability, final price, payment, or booking before operator confirmation."
            ]
          }
        }
      }
    });

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
                        from: inboundPhone,
                        id: "wamid.traveller.marketplace.llm",
                        type: "text",
                        text: {
                          body: "what is bluepass?"
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
    const whatsAppRequest = fetchMock.mock.calls.find((call) => String(call[0]).includes("graph.facebook.com"));
    const whatsAppBody = JSON.parse(String((whatsAppRequest?.[1] as RequestInit).body));

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("api.openai.com"))).toBe(true);
    expect(whatsAppBody.text.body).toContain("ocean-travel concierge");
    expect(whatsAppBody.text.body).not.toContain("Current status");
  }, 20_000);

  it("keeps traveller recommendation follow-ups in marketplace instead of latest inquiry status", async () => {
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";

    const tenantSlug = `bluepass-whatsapp-recommendation-followup-${randomUUID()}`;
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = tenantSlug;
    const inboundPhone = "6285156246329";

    let replyCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      replyCount += 1;

      return Response.json({
        messages: [{ id: `wamid.recommendation.followup.${replyCount}` }]
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const tenant = await prisma.tenant.create({
      data: {
        slug: tenantSlug,
        name: "BluePass WhatsApp Recommendation Follow-up Test",
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: ["https://bluepass.co"],
        status: "ACTIVE",
        config: {
          create: {
            supportedChannels: ["WEB_WIDGET", "WHATSAPP"],
            enabledFeatures: ["widget_config", "bluepass_marketplace", "operator_whatsapp_dispatch"],
            requiredSlots: {},
            bookingMode: "MANUAL_INQUIRY",
            bookingWriteEnabled: false,
            pmsProvider: "MOCK",
            escalationRules: [],
            responseGuardrails: [
              "Do not confirm availability, final price, payment, or booking before operator confirmation."
            ]
          }
        }
      }
    });
    const whatsappConversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        channel: "WHATSAPP",
        travellerId: inboundPhone
      }
    });
    await createOrReuseBluePassInquiry({
      tenantId: tenant.id,
      conversationId: whatsappConversation.id,
      travellerMessage: "Alila Purnama in Komodo for 2 guests on 13 July 2026",
      intent: {
        destination: "Komodo",
        dateWindow: "13 July 2026",
        guests: 2,
        travellerName: "Putro",
        travellerEmail: "putro@example.com",
        travellerPhone: "085156246329"
      },
      selectedYacht: {
        slug: "alila-purnama",
        name: "Alila Purnama",
        operatorId: "operator_alila_purnama",
        operatorName: "Alila Purnama",
        operatorPhone: "6285337210180"
      }
    });

    const basePayload = (body: string, id: string) => ({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: inboundPhone,
                    id,
                    type: "text",
                    text: { body }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    await POST(
      new Request("http://localhost/api/whatsapp/webhook", {
        method: "POST",
        body: JSON.stringify(basePayload("do you have recommendation for me in komodo?", "wamid.recommendation.start"))
      })
    );
    await POST(
      new Request("http://localhost/api/whatsapp/webhook", {
        method: "POST",
        body: JSON.stringify(basePayload("maybe 17th july and 4 people", "wamid.recommendation.details"))
      })
    );
    await POST(
      new Request("http://localhost/api/whatsapp/webhook", {
        method: "POST",
        body: JSON.stringify(basePayload("can you give me another recommendations?", "wamid.recommendation.more"))
      })
    );

    const whatsAppBodies = fetchMock.mock.calls
      .filter((call: Parameters<typeof fetch>) => Boolean((call[1] as RequestInit | undefined)?.body))
      .map((call: Parameters<typeof fetch>) => JSON.parse(String((call[1] as RequestInit).body)).text.body as string);
    const messages = await prisma.message.findMany({
      where: { conversationId: whatsappConversation.id },
      orderBy: { createdAt: "asc" }
    });

    expect(whatsAppBodies).toHaveLength(3);
    expect(whatsAppBodies[1]).not.toContain("Current status");
    expect(whatsAppBodies[1]).not.toContain("Operator Pending");
    expect(whatsAppBodies[2]).not.toContain("Current status");
    expect(whatsAppBodies[2]).not.toContain("Operator Pending");
    expect(messages.map((message) => message.role)).toEqual([
      "TRAVELLER",
      "ASSISTANT",
      "TRAVELLER",
      "ASSISTANT",
      "TRAVELLER",
      "ASSISTANT"
    ]);
  }, 30_000);

  it("dispatches the next alternative when a traveller approves alternatives over WhatsApp after a decline", async () => {
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";

    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        messages: [{ id: "wamid.alternative.reply" }]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-whatsapp-alt-${randomUUID()}`,
        name: "BluePass WhatsApp Alternative Test",
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
    const first = await createOrReuseBluePassInquiry({
      tenantId: tenant.id,
      conversationId: conversation.id,
      travellerMessage: "Calico Jack in Komodo for 4 guests on 20 July 2026",
      intent: {
        destination: "Komodo",
        dateWindow: "20 July 2026",
        guests: 4,
        travellerName: "Ekap",
        travellerEmail: "ekap@example.com",
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
    await dispatchBluePassOperatorWhatsApp({ inquiryId: first.inquiry.id });
    await handleBluePassOperatorResponse({
      inquiryId: first.inquiry.id,
      action: "decline",
      providerMessageId: "wamid.calico.decline"
    });

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
                        from: "6285156246329",
                        id: "wamid.traveller.alt",
                        type: "text",
                        text: {
                          body: "try Alila Purnama"
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
    const alternative = await prisma.bluePassInquiry.findFirstOrThrow({
      where: {
        conversationId: conversation.id,
        selectedYachtSlug: "alila-purnama"
      },
      include: {
        dispatches: true,
        events: true
      }
    });
    const assistantReply = await prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: { contains: "I sent the next operator inquiry" }
      },
      orderBy: { createdAt: "desc" }
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      contextHandled: 1,
      contextFailed: 0
    });
    expect(alternative).toMatchObject({
      status: "OPERATOR_PENDING",
      selectedYachtName: "Alila Purnama",
      destination: "Komodo",
      dateWindow: "20 July 2026",
      guests: 4
    });
    expect(alternative.dispatches[0]).toMatchObject({
      status: "QUEUED",
      operatorName: "Alila Purnama",
      operatorPhone: "+6281234567001"
    });
    expect(alternative.events.find((event) => event.type === "INQUIRY_CREATED")?.metadata).toMatchObject({
      reason: "operator_declined",
      previousInquiryId: first.inquiry.id,
      previousYachtSlug: "calico-jack",
      alternativeYachtSlug: "alila-purnama"
    });
    expect(alternative.events.find((event) => event.type === "WHATSAPP_CONTEXT_REPLY_SENT")?.metadata).toMatchObject({
      participant: "traveller",
      inboundProviderMessageId: "wamid.traveller.alt"
    });
    expect(assistantReply?.content).toContain("Alila Purnama");
  }, 30_000);

  it("dispatches the first declined alternative when a traveller replies yes over WhatsApp", async () => {
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";

    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        messages: [{ id: "wamid.alternative.yes.reply" }]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-whatsapp-alt-yes-${randomUUID()}`,
        name: "BluePass WhatsApp Alternative Yes Test",
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
    const first = await createOrReuseBluePassInquiry({
      tenantId: tenant.id,
      conversationId: conversation.id,
      travellerMessage: "Calico Jack in Komodo for 2 guests on 13 July 2026",
      intent: {
        destination: "Komodo",
        dateWindow: "13 July 2026",
        guests: 2,
        travellerName: "Putra",
        travellerEmail: "putra@example.com",
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
    await dispatchBluePassOperatorWhatsApp({ inquiryId: first.inquiry.id });
    await handleBluePassOperatorResponse({
      inquiryId: first.inquiry.id,
      action: "decline",
      providerMessageId: "wamid.calico.yes.decline"
    });

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
                        from: "6285156246329",
                        id: "wamid.traveller.alt.yes",
                        type: "text",
                        text: {
                          body: "yes"
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
    const alternative = await prisma.bluePassInquiry.findFirstOrThrow({
      where: {
        conversationId: conversation.id,
        selectedYachtSlug: "alila-purnama"
      },
      include: {
        dispatches: true
      }
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      contextHandled: 1,
      contextFailed: 0
    });
    expect(alternative).toMatchObject({
      status: "OPERATOR_PENDING",
      selectedYachtName: "Alila Purnama",
      destination: "Komodo",
      dateWindow: "13 July 2026",
      guests: 2
    });
    expect(alternative.dispatches[0]).toMatchObject({
      status: "QUEUED",
      operatorName: "Alila Purnama"
    });
  }, 30_000);

  it("lets a new traveller create a BluePass inquiry entirely from WhatsApp", async () => {
    process.env.BLUEPASS_TEST_OPERATOR_PHONE = "6285337210180";
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";

    const tenantSlug = `bluepass-whatsapp-booking-${randomUUID()}`;
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = tenantSlug;
    const phoneSuffix = randomUUID().replace(/\D/g, "").padEnd(9, "7").slice(0, 9);
    const inboundPhone = `6285${phoneSuffix}`;
    const localTravellerPhone = `085${phoneSuffix}`;

    let replyCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      replyCount += 1;
      return Response.json({
        messages: [{ id: `wamid.traveller.reply.${replyCount}` }]
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const tenant = await prisma.tenant.create({
      data: {
        slug: tenantSlug,
        name: "BluePass WhatsApp Booking Test",
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: ["https://bluepass.co"],
        status: "ACTIVE",
        config: {
          create: {
            supportedChannels: ["WEB_WIDGET", "WHATSAPP"],
            enabledFeatures: ["widget_config", "bluepass_marketplace", "operator_whatsapp_dispatch"],
            requiredSlots: {},
            bookingMode: "MANUAL_INQUIRY",
            bookingWriteEnabled: false,
            pmsProvider: "MOCK",
            escalationRules: [],
            responseGuardrails: [
              "Do not confirm availability, final price, payment, or booking before operator confirmation."
            ]
          }
        }
      }
    });

    const basePayload = (body: string, id: string) => ({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: inboundPhone,
                    id,
                    type: "text",
                    text: { body }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    await POST(
      new Request("http://localhost/api/whatsapp/webhook", {
        method: "POST",
        body: JSON.stringify(
          basePayload("I want to book Calico Jack in Komodo for 2 guests on 16 July 2026", "wamid.traveller.start")
        )
      })
    );
    await POST(
      new Request("http://localhost/api/whatsapp/webhook", {
        method: "POST",
        body: JSON.stringify(
          basePayload(
            `My name is Ara, email is ara@example.com, and WhatsApp number is ${localTravellerPhone}`,
            "wamid.traveller.contact"
          )
        )
      })
    );
    const confirmResponse = await POST(
      new Request("http://localhost/api/whatsapp/webhook", {
        method: "POST",
        body: JSON.stringify(basePayload("yes", "wamid.traveller.confirm"))
      })
    );
    const confirmBody = await confirmResponse.json();
    expect(confirmBody.contextFailures).toEqual([]);
    expect(confirmBody).toMatchObject({
      ok: true,
      contextHandled: 1,
      contextFailed: 0
    });
    const conversation = await prisma.conversation.findFirstOrThrow({
      where: {
        tenantId: tenant.id,
        channel: "WHATSAPP",
        travellerId: inboundPhone
      },
      include: {
        messages: { orderBy: { createdAt: "asc" } }
      }
    });
    const inquiry = await prisma.bluePassInquiry.findFirstOrThrow({
      where: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        selectedYachtSlug: "calico-jack"
      },
      include: {
        dispatches: true
      }
    });
    const lastRequestBody = JSON.parse(String((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body));

    expect(confirmResponse.status).toBe(200);
    expect(inquiry).toMatchObject({
      status: "OPERATOR_PENDING",
      selectedYachtName: "Calico Jack",
      destination: "Komodo",
      dateWindow: "16 July 2026",
      guests: 2,
      travellerName: "Ara",
      travellerEmail: "ara@example.com",
      travellerPhone: localTravellerPhone
    });
    expect(inquiry.dispatches[0]).toMatchObject({
      status: "QUEUED",
      operatorName: "Calico Jack",
      operatorPhone: "+6281234567004"
    });
    expect(conversation.messages.map((message) => message.role)).toEqual([
      "TRAVELLER",
      "ASSISTANT",
      "TRAVELLER",
      "ASSISTANT",
      "TRAVELLER",
      "ASSISTANT"
    ]);
    expect(lastRequestBody.text.body).toContain("Calico Jack");
    expect(lastRequestBody.text.body).toContain("operator");
  }, 30_000);

  it("uses the LLM rewrite layer for operator WhatsApp context questions without losing required facts", async () => {
    process.env.ENABLE_LLM = "true";
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_OPS = "1115079071692326";

    const operatorPhone = "+6285337210180";
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes("api.openai.com")) {
        return Response.json({
          output_text:
            "For Calico Jack, this is Putro's Komodo / 20 July 2026 / 2 guests inquiry and the current status is operator pending. Please reply with availability, a counter-offer, payment details, or booking confirmation."
        });
      }

      return Response.json({
        messages: [{ id: "wamid.operator.llm.reply" }]
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-whatsapp-operator-llm-${randomUUID()}`,
        name: "BluePass WhatsApp Operator LLM Test",
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
      travellerMessage: "Calico Jack in Komodo for 2 guests on 20 July 2026",
      intent: {
        destination: "Komodo",
        dateWindow: "20 July 2026",
        guests: 2,
        travellerName: "Putro",
        travellerEmail: "putro@example.com",
        travellerPhone: "085999000002"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone
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
                        from: operatorPhone,
                        id: "wamid.operator.context.llm",
                        type: "text",
                        text: {
                          body: "what should I send now?"
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
    const whatsAppRequest = fetchMock.mock.calls.find((call) => String(call[0]).includes("graph.facebook.com"));
    const whatsAppBody = JSON.parse(String((whatsAppRequest?.[1] as RequestInit).body));

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      contextHandled: 1,
      contextFailed: 0
    });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("api.openai.com"))).toBe(true);
    expect(whatsAppBody.text.body).toContain("Calico Jack");
    expect(whatsAppBody.text.body).toContain("Komodo / 20 July 2026 / 2 guests");
    expect(whatsAppBody.text.body).toContain("operator pending");
  }, 30_000);

  it("uses the LLM rewrite layer for traveller WhatsApp context questions without confirming bookings", async () => {
    process.env.ENABLE_LLM = "true";
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";

    const phoneSuffix = randomUUID().replace(/\D/g, "").padEnd(9, "8").slice(0, 9);
    const travellerPhone = `6285${phoneSuffix}`;
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes("api.openai.com")) {
        return Response.json({
          output_text:
            "Your Calico Jack inquiry for Komodo / 21 July 2026 / 2 guests is accepted by the operator, but it is not a confirmed booking yet. BluePass is waiting for the final quote and payment instructions."
        });
      }

      return Response.json({
        messages: [{ id: "wamid.traveller.llm.reply" }]
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-whatsapp-traveller-llm-${randomUUID()}`,
        name: "BluePass WhatsApp Traveller LLM Test",
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
      travellerMessage: "Calico Jack in Komodo for 2 guests on 21 July 2026",
      intent: {
        destination: "Komodo",
        dateWindow: "21 July 2026",
        guests: 2,
        travellerName: "Ara",
        travellerEmail: "ara@example.com",
        travellerPhone
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone: "+6285337210180"
      }
    });
    await prisma.bluePassInquiry.update({
      where: { id: created.inquiry.id },
      data: { status: "OPERATOR_ACCEPTED" }
    });

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
                        from: travellerPhone,
                        id: "wamid.traveller.context.llm",
                        type: "text",
                        text: {
                          body: "is my booking confirmed?"
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
    const whatsAppRequest = fetchMock.mock.calls.find((call) => String(call[0]).includes("graph.facebook.com"));
    const whatsAppBody = JSON.parse(String((whatsAppRequest?.[1] as RequestInit).body));

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      contextHandled: 1,
      contextFailed: 0
    });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("api.openai.com"))).toBe(true);
    expect(whatsAppBody.text.body).toContain("Calico Jack");
    expect(whatsAppBody.text.body).toContain("Komodo / 21 July 2026 / 2 guests");
    expect(whatsAppBody.text.body).toContain("not a confirmed booking");
  }, 30_000);
});
