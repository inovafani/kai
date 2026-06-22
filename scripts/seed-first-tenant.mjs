import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const requiredSlots = {
  instantBooking: ["productId", "date", "guests", "travellerName", "travellerEmail"],
  inquiry: ["productId", "date", "guests", "travellerName", "travellerEmail", "notes"]
};

const responseGuardrails = [
  "Do not invent availability.",
  "Do not invent final prices.",
  "Do not confirm a booking without a booking tool result."
];

const tenants = [
  {
    slug: "kai-demo",
    name: "Kai Demo",
    widgetPublicKey: "pk_test_kai_demo",
    allowedOrigins: ["http://localhost:3107", "http://127.0.0.1:3107"],
    defaultLocale: "en",
    branding: {
      logoUrl: null,
      primaryColor: "#0f766e",
      widgetTitle: "Kai",
      welcomeMessage: "Hi, I am Kai. How can I help with your booking?",
      brandVoice: "Warm, concise, practical, and grounded in tenant data."
    },
    config: {
      supportedChannels: ["WEB_WIDGET"],
      enabledFeatures: ["widget_config", "mock_pms"],
      requiredSlots,
      bookingMode: "MANUAL_INQUIRY",
      bookingWriteEnabled: false,
      pmsProvider: "MOCK",
      publicProductCatalog: [],
      escalationRules: ["human_requested", "custom_quote", "safety_or_refund"],
      responseGuardrails
    }
  },
  {
    slug: "boattime",
    name: "Boattime Yacht Charters",
    widgetPublicKey: "pk_test_boattime",
    allowedOrigins: ["http://localhost:3107", "http://127.0.0.1:3107"],
    defaultLocale: "en-AU",
    branding: {
      logoUrl: null,
      primaryColor: "#0b4f6c",
      widgetTitle: "Kai",
      welcomeMessage: "Hi, I am Kai. How can I help with your yacht charter?",
      brandVoice: "Polished, calm, premium, helpful, and grounded in Boattime yacht charter options."
    },
    config: {
      supportedChannels: ["WEB_WIDGET"],
      enabledFeatures: ["widget_config", "mock_pms", "boattime_local_demo"],
      requiredSlots,
      bookingMode: "MANUAL_INQUIRY",
      bookingWriteEnabled: false,
      pmsProvider: "REZDY",
      publicProductCatalog: [
        {
          publicTitle: "Gold Coast Whale Escape",
          publicDescription: "Luxury whale watching cruise",
          productUrl: "http://localhost:3107/demo/boattime#gold-coast-whale-escape",
          pmsProductId: "PGG8QT",
          bookingMode: "AUTO_BOOKING"
        },
        {
          publicTitle: "Twilight Drift",
          publicDescription: "Broadwater sunset tour and scenic cruise",
          productUrl: "http://localhost:3107/demo/boattime#twilight-drift",
          pmsProductId: "P4APMF",
          bookingMode: "AUTO_BOOKING"
        },
        {
          publicTitle: "Broadwater Twilight Dining",
          publicDescription: "Gold Coast buffet dinner cruise",
          productUrl: "http://localhost:3107/demo/boattime#broadwater-twilight-dining",
          pmsProductId: "P1D0SB",
          bookingMode: "AUTO_BOOKING"
        },
        {
          publicTitle: "Coastal Lunch Escape",
          publicDescription: "Gold Coast daytime dining cruise",
          productUrl: "http://localhost:3107/demo/boattime#coastal-lunch-escape",
          pmsProductId: "PJEJ0P",
          bookingMode: "AUTO_BOOKING"
        },
        {
          publicTitle: "Private Yacht Charter",
          publicDescription: "Tailored private yacht charter requiring operator confirmation",
          productUrl: "http://localhost:3107/demo/boattime#private-yacht-charter",
          pmsProductId: "boattime-private-yacht-charter",
          bookingMode: "MANUAL_INQUIRY"
        }
      ],
      escalationRules: ["private_charter", "large_group", "wedding_or_corporate_event", "human_requested"],
      responseGuardrails: [
        ...responseGuardrails,
        "For Boattime private charters, collect details and route to operator confirmation."
      ]
    }
  }
];

async function upsertTenant(tenant) {
  return prisma.tenant.upsert({
    where: { slug: tenant.slug },
    update: {
      name: tenant.name,
      widgetPublicKey: tenant.widgetPublicKey,
      allowedOrigins: tenant.allowedOrigins,
      defaultLocale: tenant.defaultLocale,
      status: "ACTIVE",
      branding: {
        upsert: {
          create: tenant.branding,
          update: tenant.branding
        }
      },
      config: {
        upsert: {
          create: tenant.config,
          update: tenant.config
        }
      }
    },
    create: {
      slug: tenant.slug,
      name: tenant.name,
      widgetPublicKey: tenant.widgetPublicKey,
      allowedOrigins: tenant.allowedOrigins,
      defaultLocale: tenant.defaultLocale,
      status: "ACTIVE",
      branding: { create: tenant.branding },
      config: { create: tenant.config }
    }
  });
}

async function main() {
  for (const tenant of tenants) {
    const record = await upsertTenant(tenant);
    console.log(`Seeded tenant ${record.slug} with widget key ${record.widgetPublicKey}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
