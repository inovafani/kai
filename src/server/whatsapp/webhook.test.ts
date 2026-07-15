import { describe, expect, it } from "vitest";
import {
  extractBluePassOperatorResponsesFromWhatsAppWebhook,
  extractWhatsAppInboundTextMessagesFromWebhook,
  extractWhatsAppMessageStatusesFromWebhook
} from "./webhook";

describe("extractBluePassOperatorResponsesFromWhatsAppWebhook", () => {
  it("extracts BluePass operator quick reply button payloads", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
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
                        id: "accept:inquiry_123",
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
    });

    expect(responses).toEqual([
      {
        inquiryId: "inquiry_123",
        action: "accept",
        providerMessageId: "wamid.operator.accept",
        operatorPhone: "6285337210180",
        counterText: null
      }
    ]);
  });

  it("extracts counter details from operator free text replies", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.counter",
                    type: "text",
                    text: {
                      body: "counter:inquiry_456 Available 21 July instead at USD 48,000"
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([
      {
        inquiryId: "inquiry_456",
        action: "counter",
        providerMessageId: "wamid.operator.counter",
        operatorPhone: "6285337210180",
        counterText: "Available 21 July instead at USD 48,000"
      }
    ]);
  });

  it("treats natural counter details as a counter reply without exposing an internal id", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.natural_counter",
                    type: "text",
                    text: {
                      body: "Available 18 July 2026. Final price USD 3,900 per cabin/night for 4 guests. Includes full board meals. Excludes flights. Condition: 30% deposit."
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([
      {
        inquiryId: null,
        action: "counter",
        providerMessageId: "wamid.operator.natural_counter",
        operatorPhone: "6285337210180",
        counterText:
          "Available 18 July 2026. Final price USD 3,900 per cabin/night for 4 guests. Includes full board meals. Excludes flights. Condition: 30% deposit."
      }
    ]);
  });

  it("treats short availability replies as operator accept replies", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.natural_accept",
                    type: "text",
                    text: {
                      body: "Yes available, we can do it."
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([
      {
        inquiryId: null,
        action: "accept",
        providerMessageId: "wamid.operator.natural_accept",
        operatorPhone: "6285337210180",
        counterText: null
      }
    ]);
  });

  it("does not treat traveller-style alternative permission as an operator accept reply", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285156246329",
                    id: "wamid.traveller.alt_permission",
                    type: "text",
                    text: {
                      body: "yes send the alternative"
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([]);
  });

  it("does not treat traveller yacht selection as an operator reply", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285156246329",
                    id: "wamid.traveller.alt_selection",
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
    });

    expect(responses).toEqual([]);
  });

  it("treats short sold-out replies as operator decline replies", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.natural_decline",
                    type: "text",
                    text: {
                      body: "20 July full, sorry."
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([
      {
        inquiryId: null,
        action: "decline",
        providerMessageId: "wamid.operator.natural_decline",
        operatorPhone: "6285337210180",
        counterText: null
      }
    ]);
  });

  it("treats operator hold and payment details as a payment-ready reply", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
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
    });

    expect(responses).toEqual([
      {
        inquiryId: null,
        action: "payment_ready",
        providerMessageId: "wamid.operator.payment_ready",
        operatorPhone: "6285337210180",
        counterText:
          "Slot held for 22 July. Payment link: https://pay.example/cj-22. Deposit 30% due today. Booking reference CJ-2207."
      }
    ]);
  });

  it("treats short operator payment link replies as payment-ready details", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.short_payment_ready",
                    type: "text",
                    text: {
                      body: "Pay here: https://pay.example/cj-22. Ref CJ-2207. Slot on 22 July."
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([
      {
        inquiryId: null,
        action: "payment_ready",
        providerMessageId: "wamid.operator.short_payment_ready",
        operatorPhone: "6285337210180",
        counterText: "Pay here: https://pay.example/cj-22. Ref CJ-2207. Slot on 22 July."
      }
    ]);
  });

  it("treats operator payment received and booking confirmation as a booking-confirmed reply", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
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
    });

    expect(responses).toEqual([
      {
        inquiryId: null,
        action: "booking_confirmed",
        providerMessageId: "wamid.operator.booking_confirmed",
        operatorPhone: "6285337210180",
        counterText: "Payment received. Booking confirmed for 22 July. Booking reference CJ-2207."
      }
    ]);
  });

  it("treats short paid booking replies as booking-confirmed details", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.short_booking_confirmed",
                    type: "text",
                    text: {
                      body: "Payment done, booking ok. Ref CJ-2207."
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([
      {
        inquiryId: null,
        action: "booking_confirmed",
        providerMessageId: "wamid.operator.short_booking_confirmed",
        operatorPhone: "6285337210180",
        counterText: "Payment done, booking ok. Ref CJ-2207."
      }
    ]);
  });

  it("extracts Meta button payload replies", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.button",
                    type: "button",
                    button: {
                      payload: "accept:inquiry_789",
                      text: "Accept"
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([
      {
        inquiryId: "inquiry_789",
        action: "accept",
        providerMessageId: "wamid.operator.button",
        operatorPhone: "6285337210180",
        counterText: null
      }
    ]);
  });

  it("does not treat a traveller's 'Send inquiry' button tap as an operator reply", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285156246329",
                    id: "wamid.traveller.send_inquiry_tap",
                    type: "interactive",
                    interactive: {
                      type: "button_reply",
                      button_reply: {
                        id: "Send inquiry",
                        title: "Send inquiry"
                      }
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([]);
  });

  it("extracts text-only button replies so the route can resolve latest operator context", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.button_text",
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
    });

    expect(responses).toEqual([
      {
        inquiryId: null,
        action: "accept",
        providerMessageId: "wamid.operator.button_text",
        operatorPhone: "6285337210180",
        counterText: null
      }
    ]);
  });
});

describe("extractWhatsAppInboundTextMessagesFromWebhook", () => {
  it("extracts a traveller's tapped interactive button reply as conversational context", () => {
    const messages = extractWhatsAppInboundTextMessagesFromWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285156246329",
                    id: "wamid.traveller.button_tap",
                    type: "interactive",
                    interactive: {
                      type: "button_reply",
                      button_reply: {
                        id: "Send inquiry",
                        title: "Send inquiry"
                      }
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(messages).toEqual([
      {
        from: "6285156246329",
        providerMessageId: "wamid.traveller.button_tap",
        body: "Send inquiry"
      }
    ]);
  });

  it("extracts ordinary inbound WhatsApp text messages for conversational context", () => {
    const messages = extractWhatsAppInboundTextMessagesFromWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285156246329",
                    id: "wamid.traveller.status",
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
    });

    expect(messages).toEqual([
      {
        from: "6285156246329",
        providerMessageId: "wamid.traveller.status",
        body: "what is my booking status?"
      }
    ]);
  });

  it("does not treat empty text messages as conversational context", () => {
    const messages = extractWhatsAppInboundTextMessagesFromWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285156246329",
                    id: "wamid.empty",
                    type: "text",
                    text: {
                      body: "   "
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(messages).toEqual([]);
  });
});

describe("extractWhatsAppMessageStatusesFromWebhook", () => {
  it("extracts Meta delivery statuses for outbound traveller messages", () => {
    const statuses = extractWhatsAppMessageStatusesFromWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: "wamid.traveller.accept",
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
    });

    expect(statuses).toEqual([
      {
        providerMessageId: "wamid.traveller.accept",
        status: "failed",
        timestamp: "1780000000",
        recipientId: "6285156246329",
        errors: [
          {
            code: 131026,
            title: "Message undeliverable",
            message: "Message was not delivered.",
            details: "Recipient phone number is not in the allowed list."
          }
        ]
      }
    ]);
  });
});
