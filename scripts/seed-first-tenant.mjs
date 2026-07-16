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
        "For Boattime private charters, collect details and route to operator confirmation.",
        "Answer general travel and trip questions naturally using your own knowledge, even outside the PMS catalog, as long as you stay honest about what is actually live-bookable."
      ]
    }
  },
  {
    slug: "bluepass",
    name: "BluePass",
    widgetPublicKey: "pk_test_bluepass",
    allowedOrigins: [
      "https://bluepass.co",
      "https://www.bluepass.co",
      "http://localhost:3107",
      "http://127.0.0.1:3107"
    ],
    defaultLocale: "en",
    branding: {
      logoUrl: null,
      primaryColor: "#0f766e",
      widgetTitle: "Kai",
      welcomeMessage: "Tell me where you want to go, and I will help shape the right ocean trip.",
      brandVoice: "Trustworthy, concierge-like, ocean-travel fluent, and grounded in verified BluePass marketplace data."
    },
    config: {
      supportedChannels: ["WEB_WIDGET", "WHATSAPP"],
      enabledFeatures: ["widget_config", "bluepass_marketplace", "referral_ledger", "operator_whatsapp_dispatch"],
      requiredSlots,
      bookingMode: "MANUAL_INQUIRY",
      bookingWriteEnabled: false,
      pmsProvider: "NATIVE",
      publicProductCatalog: [],
      escalationRules: [
        "custom_quote",
        "operator_confirmation_required",
        "large_group",
        "creator_referral",
        "human_requested"
      ],
      responseGuardrails: [
        ...responseGuardrails,
        "For BluePass marketplace inquiries, do not confirm availability or final price before operator acceptance.",
        "Preserve referral context and route qualified leads through BluePass inquiry and operator WhatsApp workflows.",
        "Position BluePass Protection and conservation contribution only when relevant to the traveller decision."
      ]
    }
  },
  {
    // Pilot tenant proving the generic Rezdy instant-booking pattern (see registry.ts) works for a
    // second, distinct tenant under a BluePass brand voice - not a real second AU operator yet.
    // Deliberately reuses boattime's own real Rezdy sandbox account (see scripts/link-rezdy-credentials.mjs),
    // wired through the per-tenant TenantIntegration path rather than the shared global env vars, so
    // onboarding a real distinct AU operator later is a credentials-only change.
    slug: "bluepass-au",
    name: "BluePass Australia (Rezdy pilot)",
    widgetPublicKey: "pk_test_bluepass_au",
    // localhost:3107 for the /embed/kai iframe pattern; bluepass.co for the server-to-server
    // proxy pattern (bluepass-app's homepage widget), which sends an explicit origin header.
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
      brandVoice: "Trustworthy, concierge-like BluePass voice, proving instant Gold Coast charter booking ahead of a full Australia operator rollout."
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
