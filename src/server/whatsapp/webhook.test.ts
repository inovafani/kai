import { describe, expect, it } from "vitest";
import {
  extractBluePassOperatorResponsesFromWhatsAppWebhook,
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
