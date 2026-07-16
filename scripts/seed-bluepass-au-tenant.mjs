import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Deliberately standalone, not a re-run of seed-first-tenant.mjs: that script upserts all four
// tenants (kai-demo, boattime, bluepass, bluepass-au) from their hardcoded definitions, and the
// live database has drifted from those definitions via manual admin-settings edits since it was
// last run (most importantly boattime's bookingWriteEnabled, fixed to true in production outside
// of this script). Re-running the full script would silently revert that. This script only ever
// inserts/updates the single new "bluepass-au" row, so it cannot touch boattime/bluepass/kai-demo.
const requiredSlots = {
  instantBooking: ["productId", "date", "guests", "travellerName", "travellerEmail"],
  inquiry: ["productId", "date", "guests", "travellerName", "travellerEmail", "notes"]
};

const responseGuardrails = [
  "Do not invent availability.",
  "Do not invent final prices.",
  "Do not confirm a booking without a booking tool result."
];

const bluepassAuTenant = {
  slug: "bluepass-au",
  name: "BluePass Australia (Rezdy pilot)",
  widgetPublicKey: "pk_test_bluepass_au",
  // localhost/127.0.0.1:3107 is Kai's own origin (needed for the /embed/kai iframe pattern, which
  // always calls Kai's relative API paths from Kai's own origin regardless of the embedding page).
  // bluepass.co is needed separately for the server-to-server proxy pattern (bluepass-app's
  // KaiWebChat -> /api/kai/web-chat -> this tenant), which sends an explicit origin header of
  // KAI_CORE_ORIGIN (bluepass.co) rather than relying on the browser's own request origin.
  allowedOrigins: [
    "http://localhost:3107",
    "http://127.0.0.1:3107",
    "https://bluepass.co",
    "https://www.bluepass.co"
  ],
  defaultLocale: "en-AU",
  branding: {
    logoUrl: null,
    primaryColor: "#0f766e",
    widgetTitle: "Kai",
    welcomeMessage: "Ask me about Gold Coast charter trips - I can check live availability and book instantly.",
    brandVoice:
      "Trustworthy, concierge-like BluePass voice, proving instant Gold Coast charter booking ahead of a full Australia operator rollout."
  },
  config: {
    supportedChannels: ["WEB_WIDGET"],
    enabledFeatures: ["widget_config", "mock_pms"],
    requiredSlots,
    bookingMode: "AUTO_BOOKING",
    bookingWriteEnabled: true,
    pmsProvider: "REZDY",
    publicProductCatalog: [
      {
        publicTitle: "Gold Coast Whale Escape",
        publicDescription: "Luxury whale watching cruise",
        productUrl: "http://localhost:3000/kai-au-demo#gold-coast-whale-escape",
        pmsProductId: "PGG8QT",
        bookingMode: "AUTO_BOOKING",
        extraOptions: [
          { label: "Corona Bucket", unitPriceCents: 3000 },
          { label: "Sparkling for 2", unitPriceCents: 4000 },
          { label: "Cheese Platter for 2", unitPriceCents: 1000 }
        ]
      },
      {
        publicTitle: "Twilight Drift",
        publicDescription: "Broadwater sunset tour and scenic cruise",
        productUrl: "http://localhost:3000/kai-au-demo#twilight-drift",
        pmsProductId: "P4APMF",
        bookingMode: "AUTO_BOOKING"
      },
      {
        publicTitle: "Broadwater Twilight Dining",
        publicDescription: "Gold Coast buffet dinner cruise",
        productUrl: "http://localhost:3000/kai-au-demo#broadwater-twilight-dining",
        pmsProductId: "P1D0SB",
        bookingMode: "AUTO_BOOKING"
      },
      {
        publicTitle: "Coastal Lunch Escape",
        publicDescription: "Gold Coast daytime dining cruise",
        productUrl: "http://localhost:3000/kai-au-demo#coastal-lunch-escape",
        pmsProductId: "PJEJ0P",
        bookingMode: "AUTO_BOOKING"
      }
    ],
    escalationRules: ["large_group", "wedding_or_corporate_event", "human_requested"],
    responseGuardrails: [
      ...responseGuardrails,
      "Answer general travel and trip questions naturally using your own knowledge, even outside the PMS catalog, as long as you stay honest about what is actually live-bookable.",
      "This is a BluePass Australia pilot backed by real Gold Coast Rezdy inventory only - be honest that other Australian regions (Great Barrier Reef, Whitsundays, Ningaloo Coast) are not yet live-bookable through this pilot, even if asked about them."
    ]
  }
};

async function main() {
  const record = await prisma.tenant.upsert({
    where: { slug: bluepassAuTenant.slug },
    update: {
      name: bluepassAuTenant.name,
      widgetPublicKey: bluepassAuTenant.widgetPublicKey,
      allowedOrigins: bluepassAuTenant.allowedOrigins,
      defaultLocale: bluepassAuTenant.defaultLocale,
      status: "ACTIVE",
      branding: { upsert: { create: bluepassAuTenant.branding, update: bluepassAuTenant.branding } },
      config: { upsert: { create: bluepassAuTenant.config, update: bluepassAuTenant.config } }
    },
    create: {
      slug: bluepassAuTenant.slug,
      name: bluepassAuTenant.name,
      widgetPublicKey: bluepassAuTenant.widgetPublicKey,
      allowedOrigins: bluepassAuTenant.allowedOrigins,
      defaultLocale: bluepassAuTenant.defaultLocale,
      status: "ACTIVE",
      branding: { create: bluepassAuTenant.branding },
      config: { create: bluepassAuTenant.config }
    }
  });

  console.log(`Seeded tenant ${record.slug} with widget key ${record.widgetPublicKey}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
