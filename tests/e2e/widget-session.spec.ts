import { expect, test } from "@playwright/test";

test("widget session creates a tenant-scoped AI conversation", async ({ request }) => {
  const response = await request.post("/api/widget/session", {
    headers: {
      origin: "http://localhost:3107"
    },
    data: {
      key: "pk_test_kai_demo"
    }
  });

  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    conversation: {
      tenantSlug: "kai-demo",
      channel: "WEB_WIDGET",
      controlMode: "AI"
    }
  });
});

test("widget session rejects disallowed origins", async ({ request }) => {
  const response = await request.post("/api/widget/session", {
    headers: {
      origin: "https://evil.example.com"
    },
    data: {
      key: "pk_test_kai_demo"
    }
  });

  expect(response.status()).toBe(403);
  await expect(response.json()).resolves.toEqual({
    error: {
      code: "ORIGIN_NOT_ALLOWED",
      message: "This origin is not allowed for the resolved tenant."
    }
  });
});

test("widget message persists traveller and mock assistant messages for the resolved tenant conversation", async ({ request }) => {
  const sessionResponse = await request.post("/api/widget/session", {
    headers: {
      origin: "http://localhost:3107"
    },
    data: {
      key: "pk_test_kai_demo"
    }
  });
  const session = await sessionResponse.json();

  const messageResponse = await request.post("/api/widget/messages", {
    headers: {
      origin: "http://localhost:3107"
    },
    data: {
      key: "pk_test_kai_demo",
      conversationId: session.conversation.id,
      content: "Can you check Komodo Day Trip for 3 guests tomorrow?"
    }
  });

  expect(messageResponse.ok()).toBe(true);
  const payload = await messageResponse.json();
  expect(payload).toMatchObject({
    message: {
      tenantSlug: "kai-demo",
      conversationId: session.conversation.id,
      role: "TRAVELLER",
      content: "Can you check Komodo Day Trip for 3 guests tomorrow?"
    },
    assistantMessage: {
      tenantSlug: "kai-demo",
      conversationId: session.conversation.id,
      role: "ASSISTANT"
    }
  });
  expect(payload.assistantMessage.content).toContain("Komodo Day Trip");
  expect(payload.assistantMessage.content).toContain("3 guests");
  expect(payload.assistantMessage.content).toContain("USD 185.00");
});

test("widget message routes BluePass marketplace conversations through the business pack gate", async ({ request }) => {
  const sessionResponse = await request.post("/api/widget/session", {
    headers: {
      origin: "https://bluepass.co"
    },
    data: {
      key: "pk_test_bluepass"
    }
  });
  const session = await sessionResponse.json();

  const messageResponse = await request.post("/api/widget/messages", {
    headers: {
      origin: "https://bluepass.co"
    },
    data: {
      key: "pk_test_bluepass",
      conversationId: session.conversation.id,
      content: "Can Kai find me a yacht in Komodo for 8 guests next month?"
    }
  });

  expect(messageResponse.ok()).toBe(true);
  await expect(messageResponse.json()).resolves.toMatchObject({
    message: {
      tenantSlug: "bluepass",
      conversationId: session.conversation.id,
      role: "TRAVELLER",
      content: "Can Kai find me a yacht in Komodo for 8 guests next month?"
    },
    assistantMessage: {
      tenantSlug: "bluepass",
      conversationId: session.conversation.id,
      role: "ASSISTANT",
      content:
        "I can help shape this BluePass request, but I will route marketplace availability, referral context, and operator follow-up through the BluePass inquiry flow instead of confirming a booking here."
    },
    businessPack: {
      kind: "bluepass_marketplace",
      paymentPolicy: "operator_acceptance_required"
    },
    manualInquiry: null,
    paymentRequest: null,
    contactRequest: null
  });
});

test("widget message matches PMS product aliases before replying", async ({ request }) => {
  const sessionResponse = await request.post("/api/widget/session", {
    headers: {
      origin: "http://localhost:3107"
    },
    data: {
      key: "pk_test_kai_demo"
    }
  });
  const session = await sessionResponse.json();

  const messageResponse = await request.post("/api/widget/messages", {
    headers: {
      origin: "http://localhost:3107"
    },
    data: {
      key: "pk_test_kai_demo",
      conversationId: session.conversation.id,
      content: "private boat for 2 guests tomorrow"
    }
  });

  expect(messageResponse.ok()).toBe(true);
  await expect(messageResponse.json()).resolves.toMatchObject({
    assistantMessage: {
      tenantSlug: "kai-demo",
      conversationId: session.conversation.id,
      role: "ASSISTANT",
      content:
        "Private Charter requires operator confirmation. I can collect the details, but I will not confirm availability automatically."
    },
    manualInquiry: {
      tenantSlug: "kai-demo",
      conversationId: session.conversation.id,
      status: "OPEN",
      productExternalId: "mock-private-charter",
      productTitle: "Private Charter",
      dateText: "tomorrow",
      guests: 2
    }
  });
});

test("widget message uses prior traveller messages as slot memory", async ({ request }) => {
  const sessionResponse = await request.post("/api/widget/session", {
    headers: { origin: "http://localhost:3107" },
    data: { key: "pk_test_kai_demo" }
  });
  const session = await sessionResponse.json();

  await request.post("/api/widget/messages", {
    headers: { origin: "http://localhost:3107" },
    data: {
      key: "pk_test_kai_demo",
      conversationId: session.conversation.id,
      content: "private boat"
    }
  });

  const messageResponse = await request.post("/api/widget/messages", {
    headers: { origin: "http://localhost:3107" },
    data: {
      key: "pk_test_kai_demo",
      conversationId: session.conversation.id,
      content: "tomorrow for 2 people"
    }
  });

  expect(messageResponse.ok()).toBe(true);
  await expect(messageResponse.json()).resolves.toMatchObject({
    assistantMessage: {
      tenantSlug: "kai-demo",
      conversationId: session.conversation.id,
      role: "ASSISTANT",
      content:
        "Private Charter requires operator confirmation. I can collect the details, but I will not confirm availability automatically."
    }
  });
});

test("widget captures contact details after traveller asks to book", async ({ request }) => {
  const sessionResponse = await request.post("/api/widget/session", {
    headers: { origin: "http://localhost:3107" },
    data: { key: "pk_test_kai_demo" }
  });
  const session = await sessionResponse.json();

  await request.post("/api/widget/messages", {
    headers: { origin: "http://localhost:3107" },
    data: {
      key: "pk_test_kai_demo",
      conversationId: session.conversation.id,
      content: "Can you check Komodo Day Trip for 3 guests tomorrow?"
    }
  });

  const captureResponse = await request.post("/api/widget/messages", {
    headers: { origin: "http://localhost:3107" },
    data: {
      key: "pk_test_kai_demo",
      conversationId: session.conversation.id,
      content: "yes book it"
    }
  });

  expect(captureResponse.ok()).toBe(true);
  await expect(captureResponse.json()).resolves.toMatchObject({
    assistantMessage: {
      content:
        "I can prepare that booking request for Komodo Day Trip on tomorrow for 3 guests. Please share your name, email, phone so the operator can follow up."
    },
    manualInquiry: null
  });

  const contactResponse = await request.post("/api/widget/messages", {
    headers: { origin: "http://localhost:3107" },
    data: {
      key: "pk_test_kai_demo",
      conversationId: session.conversation.id,
      content: "My name is Maya Chen, email maya@example.com, phone +61 400 111 222"
    }
  });

  expect(contactResponse.ok()).toBe(true);
  await expect(contactResponse.json()).resolves.toMatchObject({
    assistantMessage: {
      content:
        "Thanks, I have the details for Komodo Day Trip on tomorrow for 3 guests. Booking confirmation is not enabled for this tenant yet, so I will send this to the operator for confirmation."
    },
    manualInquiry: {
      status: "OPEN",
      productTitle: "Komodo Day Trip",
      dateText: "tomorrow",
      guests: 3,
      travellerName: "Maya Chen",
      travellerEmail: "maya@example.com",
      travellerPhone: "+61 400 111 222"
    }
  });
});
