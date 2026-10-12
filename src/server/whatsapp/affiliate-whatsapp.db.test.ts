import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { clearAffiliateTripsCache } from "@/server/affiliate/affiliate-trips-client";
import { sendWhatsAppText } from "@/server/whatsapp/client";
import { clearAffiliateCatalogEnabledCache, resolveWhatsAppAffiliateTurn } from "./affiliate-whatsapp";

vi.mock("@/server/whatsapp/client", () => ({
  sendWhatsAppText: vi.fn().mockResolvedValue(undefined)
}));

// Throwaway tenants in the shared database, deleted afterwards. WhatsApp sending and the BluePass
// app's affiliate-trips endpoint are faked.
const PREFIX = "affiliate-wa-";
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
const sailTrip = {
  ...reefTrip,
  slug: "whitehaven-sail",
  title: "Whitehaven Sail",
  operatorName: "Ocean Rafting",
  region: "Whitsundays",
  category: "Sail & Yacht",
  bookingUrl: "https://fareharbor.com/embeds/book/oceanrafting/"
};
const whaleTrip = {
  ...reefTrip,
  slug: "whitsundays-whales",
  title: "Whitsundays Whale Watch",
  operatorName: "Cruise Whitsundays",
  region: "Whitsundays",
  category: "Wildlife",
  bookingUrl: "https://fareharbor.com/embeds/book/cruisewhitsundays/"
};

beforeEach(async () => {
  clearAffiliateTripsCache();
  clearAffiliateCatalogEnabledCache();
  vi.mocked(sendWhatsAppText).mockClear();
  process.env.BLUEPASS_APP_URL = "https://bluepass.example";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).endsWith("/api/kai/affiliate-trips")
        ? Response.json({ trips: [reefTrip, sailTrip, whaleTrip] })
        : new Response("not stubbed", { status: 404 })
    )
  );

  await prisma.tenant.create({
    data: {
      slug: `${PREFIX}au-${randomUUID()}`,
      name: "BluePass Australia",
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: [],
      status: "ACTIVE",
      config: {
        create: {
          supportedChannels: ["WHATSAPP"],
          enabledFeatures: ["affiliate_catalog"],
          requiredSlots: {},
          bookingMode: "AUTO_BOOKING",
          pmsProvider: "MOCK",
          escalationRules: [],
          responseGuardrails: []
        }
      }
    }
  });
  const standIn = `${PREFIX}bluepass-${randomUUID()}`;
  await prisma.tenant.create({ data: { slug: standIn, name: "BluePass", widgetPublicKey: `pk_${randomUUID()}`, allowedOrigins: [], status: "ACTIVE" } });
  process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = standIn;
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { startsWith: PREFIX } } });
});

const phone = () => `614${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const lastSentBody = () => vi.mocked(sendWhatsAppText).mock.calls.at(-1)?.[0].body ?? "";

describe("WhatsApp: trips resold as an affiliate", () => {
  it("answers a trip named by its title, even in strict mode", async () => {
    const from = phone();
    const outcome = await resolveWhatsAppAffiliateTurn({ messageText: "can I book the Outer Reef Day?", fromPhone: from }, "STRICT");
    expect(outcome.kind).toBe("HANDLED");
    expect(lastSentBody()).toContain(`Book it here: ${reefTrip.bookingUrl}`);
    expect(vi.mocked(sendWhatsAppText).mock.calls.at(-1)?.[0]).toMatchObject({ to: from, role: "kai" });
  }, 60_000);

  it("leaves general requests to the operators in strict mode, and lists trips in broad mode", async () => {
    const from = phone();
    const ask = { messageText: "what can we do in the Whitsundays?", fromPhone: from };
    expect((await resolveWhatsAppAffiliateTurn(ask, "STRICT")).kind).toBe("NONE");
    expect(sendWhatsAppText).not.toHaveBeenCalled();

    expect((await resolveWhatsAppAffiliateTurn(ask, "BROAD")).kind).toBe("HANDLED");
    expect(lastSentBody()).toContain("Here's what I'd look at:");

    // The traveller then picks a number from that list: strict mode answers it.
    expect((await resolveWhatsAppAffiliateTurn({ messageText: "1", fromPhone: from }, "STRICT")).kind).toBe("HANDLED");
    expect(lastSentBody()).toMatch(/Book it here: https:\/\/fareharbor\.com\/embeds\/book\/(oceanrafting|cruisewhitsundays)\//);
  }, 60_000);

  it("does nothing when no tenant has the feature switched on", async () => {
    await prisma.tenantConfig.updateMany({
      where: { tenant: { slug: { startsWith: PREFIX } }, enabledFeatures: { has: "affiliate_catalog" } },
      data: { enabledFeatures: [] }
    });
    const realCount = await prisma.tenant.count({ where: { status: "ACTIVE", config: { enabledFeatures: { has: "affiliate_catalog" } } } });
    if (realCount > 0) return; // a real tenant has it on in this shared database; nothing to prove here
    clearAffiliateCatalogEnabledCache();

    const outcome = await resolveWhatsAppAffiliateTurn({ messageText: "book the Outer Reef Day", fromPhone: phone() }, "BROAD");
    expect(outcome.kind).toBe("NONE");
  }, 60_000);
});
