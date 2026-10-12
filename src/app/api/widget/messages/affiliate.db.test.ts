import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { handleBluePassMarketplaceMessage } from "@/server/bluepass/bluepass-message-flow";
import { clearAffiliateTripsCache } from "@/server/affiliate/affiliate-trips-client";
import { POST } from "./route";

// Writes a throwaway tenant to the shared database (deleted afterwards). The BluePass app's
// affiliate-trips endpoint is faked, so nothing leaves this machine.
const SLUG_PREFIX = "affiliate-widget-";
const originalEnv = { ...process.env };

const reefTrip = {
  slug: "outer-reef-day",
  title: "Outer Reef Day",
  operatorName: "Reef Magic",
  region: "Great Barrier Reef",
  category: "Dive",
  description: "A full day on the outer reef from Cairns.",
  priceSignal: "From AUD 249",
  bookingPlatform: "FAREHARBOR",
  bookingUrl: "https://fareharbor.com/embeds/book/reefmagic/items/1/"
};
const whaleTrip = {
  ...reefTrip,
  slug: "hervey-bay-whales",
  title: "Hervey Bay Whale Watch",
  operatorName: "Tasman Venture",
  region: "Hervey Bay",
  category: "Wildlife",
  bookingPlatform: "REZDY",
  bookingUrl: "https://tasmanventure.rezdy.com/123/whale-watch"
};

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
  clearAffiliateTripsCache();
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
});

async function setUp(enabledFeatures: string[]) {
  process.env.BLUEPASS_APP_URL = "https://bluepass.example";
  delete process.env.ENABLE_LLM;
  const fetchMock = vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith("/api/kai/affiliate-trips") ? Response.json({ trips: [reefTrip, whaleTrip] }) : new Response("not stubbed", { status: 404 })
  );
  vi.stubGlobal("fetch", fetchMock);

  const tenant = await prisma.tenant.create({
    data: {
      slug: `${SLUG_PREFIX}${randomUUID()}`,
      name: "BluePass Australia",
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://bluepass.co"],
      status: "ACTIVE",
      config: {
        create: {
          supportedChannels: ["WEB_WIDGET"],
          enabledFeatures,
          requiredSlots: {},
          bookingMode: "AUTO_BOOKING",
          bookingWriteEnabled: false,
          pmsProvider: "MOCK",
          escalationRules: [],
          responseGuardrails: []
        }
      }
    }
  });
  const conversation = await prisma.conversation.create({ data: { tenantId: tenant.id, channel: "WEB_WIDGET", controlMode: "AI" } });
  const send = (content: string) =>
    POST(
      new NextRequest("http://localhost/api/widget/messages", {
        method: "POST",
        headers: { origin: "https://bluepass.co", "content-type": "application/json" },
        body: JSON.stringify({ key: tenant.widgetPublicKey, conversationId: conversation.id, content })
      })
    ).then((response) => response.json());
  return { send, fetchMock };
}

describe("widget: trips resold as an affiliate", () => {
  it("lists matching trips with their links, then gives one trip's link when the traveller picks it", async () => {
    const { send } = await setUp(["affiliate_catalog"]);

    const ideas = await send("what can I do on the Great Barrier Reef or in Hervey Bay?");
    expect(ideas.assistantMessage.content).toContain("Here's what I'd look at:");
    expect(ideas.assistantMessage.content).toContain(`Book: ${reefTrip.bookingUrl}`);
    expect(ideas.assistantMessage.content).toContain(`Book: ${whaleTrip.bookingUrl}`);
    expect(ideas.paymentRequest).toBeNull();
    expect(ideas.contactRequest).toBeNull();

    const picked = await send("2");
    expect(picked.assistantMessage.content).toContain("Hervey Bay Whale Watch is run by Tasman Venture");
    expect(picked.assistantMessage.content).toContain(`Book it here: ${whaleTrip.bookingUrl}`);
    expect(picked.assistantMessage.content).toContain("on Rezdy");

    const named = await send("I'd like to book the Outer Reef Day for 2 people");
    expect(named.assistantMessage.content).toContain(`Book it here: ${reefTrip.bookingUrl}`);
    expect(named.manualInquiry).toBeNull();
  }, 60_000);

  it("leaves tenants without the feature exactly as before", async () => {
    const { send, fetchMock } = await setUp([]);
    const reply = await send("I'd like to book the Outer Reef Day");
    expect(reply.assistantMessage.content).not.toContain(reefTrip.bookingUrl);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("affiliate-trips"))).toBe(false);
  }, 60_000);
});

describe("marketplace chat: a resold trip in the catalogue", () => {
  it("hands over the booking link instead of asking for details for an operator enquiry", async () => {
    const tenant = await prisma.tenant.create({
      data: {
        slug: `${SLUG_PREFIX}${randomUUID()}`,
        name: "BluePass",
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: ["https://bluepass.co"]
      }
    });
    const conversation = await prisma.conversation.create({ data: { tenantId: tenant.id, channel: "WEB_WIDGET" } });

    const result = await handleBluePassMarketplaceMessage({
      tenantId: tenant.id,
      conversationId: conversation.id,
      content: "Can I book the Outer Reef Day?",
      priorTravellerMessages: [],
      catalog: [
        {
          slug: reefTrip.slug,
          name: reefTrip.title,
          region: reefTrip.region,
          tier: reefTrip.category,
          priceSignal: reefTrip.priceSignal,
          operatorName: reefTrip.operatorName,
          about: reefTrip.description,
          bookingUrl: reefTrip.bookingUrl,
          bookingPlatform: "FAREHARBOR"
        },
        { slug: "alila-purnama", name: "Alila Purnama", region: "Komodo", priceSignal: "from USD 3,000 per cabin" }
      ]
    });

    expect(result.assistantContent).toContain(`Book it here: ${reefTrip.bookingUrl}`);
    expect(result.contactRequest).toBeNull();
    expect(result.bluepassInquiry).toBeNull();
    expect(await prisma.bluePassInquiry.count({ where: { conversationId: conversation.id } })).toBe(0);
  }, 60_000);
});
