import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/widget/config?key=pk_test_kai_demo", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tenant: {
          slug: "boattime",
          name: "Boattime Yacht Charters",
          defaultLocale: "en"
        },
        branding: {
          logoUrl: null,
          primaryColor: "#0f5f78",
          widgetTitle: "Kai",
          welcomeMessage: "Hi, I am Kai. How can I help with your booking?"
        },
        capabilities: {
          supportedChannels: ["WEB_WIDGET"],
          enabledFeatures: ["LIVE_AVAILABILITY"],
          bookingMode: "LIVE_BOOKING",
          pmsProvider: "REZDY"
        }
      })
    });
  });
});

test("embed widget loads tenant config and sends a message", async ({ page }) => {
  await page.route("**/api/widget/messages", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          id: "server-traveller-message",
          role: "TRAVELLER",
          content: "Can you help me book Komodo tomorrow?"
        },
        assistantMessage: {
          id: "server-assistant-message",
          role: "ASSISTANT",
          content: "Please share the guests so I can check safely."
        }
      })
    });
  });

  await page.goto("/embed/kai?key=pk_test_kai_demo");

  await expect(page.getByRole("heading", { name: "Kai" })).toBeVisible();
  await expect(page.getByText("Hi, I am Kai. How can I help with your booking?")).toBeVisible();

  await page.getByLabel("Message").fill("Can you help me book Komodo tomorrow?");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Can you help me book Komodo tomorrow?")).toBeVisible();
  await expect(page.getByText("Please share the guests so I can check safely.")).toBeVisible();
});

test("embed widget shows traveller message and Kai typing state immediately", async ({ page }) => {
  await page.route("**/api/widget/messages", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          id: "server-traveller-message",
          role: "TRAVELLER",
          content: "Can you check availability tomorrow?"
        },
        assistantMessage: {
          id: "server-assistant-message",
          role: "ASSISTANT",
          content: "Please share the product and number of guests so I can check safely."
        }
      })
    });
  });

  await page.goto("/embed/kai?key=pk_test_kai_demo");
  await page.getByLabel("Message").fill("Can you check availability tomorrow?");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Can you check availability tomorrow?")).toBeVisible();
  await expect(page.getByLabel("Kai is typing")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await expect(page.getByText("Please share the product and number of guests so I can check safely.")).toBeVisible();
  await expect(page.getByLabel("Kai is typing")).toHaveCount(0);
});

test("embed widget tokenizes card details before confirming a RezdyPay booking", async ({ page }) => {
  await page.addInitScript(() => {
    window.Stripe = () => ({
      elements: () => ({
        create: () => ({
          mount: (selector: string) => {
            const target = document.querySelector(selector);
            if (target) {
              target.textContent = "Mock secure card field";
            }
          },
          unmount: () => undefined
        })
      }),
      createToken: async () => ({
        token: {
          id: "tok_rezdy_mock"
        }
      })
    });
  });

  await page.route("**/api/widget/messages", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          id: "server-traveller-message",
          role: "TRAVELLER",
          content: "My name is Test4, email test4@gmail.com, phone 087665234098"
        },
        assistantMessage: {
          id: "server-assistant-message",
          role: "ASSISTANT",
          content:
            "Thanks, I have everything for Gold Coast Whale Escape on 2026-06-26 at 12:00 PM for 2 guests."
        },
        paymentRequest: {
          conversationId: "conversation_123",
          productTitle: "Gold Coast Whale Escape",
          dateText: "2026-06-26 12:00:00",
          guests: 2,
          checkoutUrl: null,
          status: "PAYMENT_PENDING"
        }
      })
    });
  });
  await page.route("**/api/widget/payments/intent", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "REZDYPAY_STRIPE",
        publishableKey: "pk_test_rezdy",
        conversationId: "conversation_123"
      })
    });
  });
  await page.route("**/api/widget/payments/confirm", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      key: "pk_test_kai_demo",
      conversationId: "conversation_123",
      cardToken: "tok_rezdy_mock"
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "CONFIRMED",
        externalBookingId: "RZ-PAID",
        provider: "REZDY"
      })
    });
  });

  await page.goto("/embed/kai?key=pk_test_kai_demo");
  await page.getByLabel("Message").fill("My name is Test4, email test4@gmail.com, phone 087665234098");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByRole("heading", { name: "Secure RezdyPay payment" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open checkout link" })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue to secure payment" }).click();
  await expect(page.getByText("Mock secure card field")).toBeVisible();
  await expect(page.getByLabel("Card details")).toHaveCSS("display", "block");
  await page.getByLabel("Name on card").fill("Test Four");
  await page.getByRole("button", { name: "Pay securely" }).click();

  await expect(page.getByText("Payment received and your booking is confirmed. Confirmation reference: RZ-PAID.")).toBeVisible();
});

test("embed widget can collect contact details with a guided form", async ({ page }) => {
  const submittedMessages: string[] = [];

  await page.route("**/api/widget/messages", async (route) => {
    const requestBody = route.request().postDataJSON() as { content?: string };
    if (requestBody.content) submittedMessages.push(requestBody.content);

    const isContactSubmit = requestBody.content?.includes("email is test@example.com");

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          id: isContactSubmit ? "server-contact-message" : "server-traveller-message",
          role: "TRAVELLER",
          content: requestBody.content
        },
        assistantMessage: {
          id: isContactSubmit ? "server-contact-reply" : "server-assistant-message",
          role: "ASSISTANT",
          content: isContactSubmit
            ? "Thanks, I have everything for Gold Coast Whale Escape."
            : "No extras added. Please share your name, email, and phone number so I can prepare the secure payment step."
        },
        contactRequest: isContactSubmit
          ? null
          : {
              conversationId: "conversation_123",
              fields: ["name", "email", "phone"],
              status: "CONTACT_DETAILS_REQUIRED"
            }
      })
    });
  });

  await page.goto("/embed/kai?key=pk_test_kai_demo");
  await page.getByLabel("Message").fill("no extras");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByRole("heading", { name: "Contact details" })).toBeVisible();
  await page.getByLabel("Full name").fill("Test Person");
  await page.getByLabel("Email").fill("test@example.com");
  await page.getByLabel("Phone").fill("087665321876");
  await page.getByRole("button", { name: "Send details" }).click();

  await expect(page.getByText("Thanks, I have everything for Gold Coast Whale Escape.")).toBeVisible();
  expect(submittedMessages).toContain("My name is Test Person, email is test@example.com, phone number is 087665321876");
});

test("embed widget shows setup error when secure payment is not configured", async ({ page }) => {
  await page.route("**/api/widget/messages", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          id: "server-traveller-message",
          role: "TRAVELLER",
          content: "My name is Test4, email test4@gmail.com, phone 087665234098"
        },
        assistantMessage: {
          id: "server-assistant-message",
          role: "ASSISTANT",
          content:
            "Thanks, I have everything for Gold Coast Whale Escape on 2026-06-26 at 12:00 PM for 2 guests."
        },
        paymentRequest: {
          conversationId: "conversation_123",
          productTitle: "Gold Coast Whale Escape",
          dateText: "2026-06-26 12:00:00",
          guests: 2,
          checkoutUrl: null,
          status: "PAYMENT_PENDING"
        }
      })
    });
  });
  await page.route("**/api/widget/payments/intent", async (route) => {
    await route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
          message: "Secure payment is not connected for this tenant yet."
        }
      })
    });
  });

  await page.goto("/embed/kai?key=pk_test_kai_demo");
  await page.getByLabel("Message").fill("My name is Test4, email test4@gmail.com, phone 087665234098");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "Continue to secure payment" }).click();

  await expect(page.getByText("Secure payment is not connected for this tenant yet.")).toBeVisible();
});
