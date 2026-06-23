import { expect, test } from "@playwright/test";

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

test("embed widget shows a secure payment panel when Kai prepares payment", async ({ page }) => {
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

  await expect(page.getByRole("heading", { name: "Secure payment" })).toBeVisible();
  await expect(page.getByText("Gold Coast Whale Escape · 2026-06-26 12:00:00 · 2 guests")).toBeVisible();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByText("Secure payment is not connected for this tenant yet.")).toBeVisible();
});

test("embed widget tokenizes card details before confirming RezdyPay booking", async ({ page }) => {
  await page.addInitScript(() => {
    window.Stripe = () => ({
      elements: () => ({
        create: () => ({
          mount: (selector: string) => {
            const target = document.querySelector(selector);
            if (target) {
              target.textContent = "Mock secure card field";
            }
          }
        })
      }),
      createToken: async () => ({
        token: {
          id: "tok_rezdy_mock"
        }
      })
    });
  });

  await page.route("https://js.stripe.com/v3/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: ""
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
        booking: {
          externalBookingId: "RZ-PAID",
          status: "CONFIRMED"
        },
        assistantMessage: {
          id: "server-payment-confirmed",
          role: "ASSISTANT",
          content:
            "Payment received and your booking is confirmed. Confirmation reference: RZ-PAID."
        }
      })
    });
  });

  await page.goto("/embed/kai?key=pk_test_kai_demo");
  await page.getByLabel("Message").fill("My name is Test4, email test4@gmail.com, phone 087665234098");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "Continue to payment" }).click();

  await expect(page.getByText("Mock secure card field")).toBeVisible();
  await page.getByLabel("Name on card").fill("Test Four");
  await page.getByRole("button", { name: "Pay securely" }).click();

  await expect(page.getByText("Payment received and your booking is confirmed.")).toBeVisible();
  await expect(page.getByText("Confirmation reference: RZ-PAID.")).toBeVisible();
});
