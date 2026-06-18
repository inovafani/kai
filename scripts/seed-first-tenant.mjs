import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const tenant = {
  slug: "kai-demo",
  name: "Kai Demo",
  widgetPublicKey: "pk_test_kai_demo",
  allowedOrigins: ["http://localhost:3107", "http://127.0.0.1:3107"],
  defaultLocale: "en"
};

async function main() {
  const record = await prisma.tenant.upsert({
    where: { slug: tenant.slug },
    update: {
      name: tenant.name,
      widgetPublicKey: tenant.widgetPublicKey,
      allowedOrigins: tenant.allowedOrigins,
      defaultLocale: tenant.defaultLocale,
      status: "ACTIVE",
      branding: {
        upsert: {
          create: {
            logoUrl: null,
            primaryColor: "#0f766e",
            widgetTitle: "Kai",
            welcomeMessage: "Hi, I am Kai. How can I help with your booking?",
            brandVoice: "Warm, concise, practical, and grounded in tenant data."
          },
          update: {
            logoUrl: null,
            primaryColor: "#0f766e",
            widgetTitle: "Kai",
            welcomeMessage: "Hi, I am Kai. How can I help with your booking?",
            brandVoice: "Warm, concise, practical, and grounded in tenant data."
          }
        }
      },
      config: {
        upsert: {
          create: {
            supportedChannels: ["WEB_WIDGET"],
            enabledFeatures: ["widget_config", "mock_pms"],
            requiredSlots: {
              instantBooking: ["productId", "date", "guests", "travellerName", "travellerEmail"],
              inquiry: ["productId", "date", "guests", "travellerName", "travellerEmail", "notes"]
            },
            bookingMode: "MANUAL_INQUIRY",
            pmsProvider: "MOCK",
            escalationRules: ["human_requested", "custom_quote", "safety_or_refund"],
            responseGuardrails: [
              "Do not invent availability.",
              "Do not invent final prices.",
              "Do not confirm a booking without a booking tool result."
            ]
          },
          update: {
            supportedChannels: ["WEB_WIDGET"],
            enabledFeatures: ["widget_config", "mock_pms"],
            requiredSlots: {
              instantBooking: ["productId", "date", "guests", "travellerName", "travellerEmail"],
              inquiry: ["productId", "date", "guests", "travellerName", "travellerEmail", "notes"]
            },
            bookingMode: "MANUAL_INQUIRY",
            pmsProvider: "MOCK",
            escalationRules: ["human_requested", "custom_quote", "safety_or_refund"],
            responseGuardrails: [
              "Do not invent availability.",
              "Do not invent final prices.",
              "Do not confirm a booking without a booking tool result."
            ]
          }
        }
      }
    },
    create: {
      ...tenant,
      status: "ACTIVE",
      branding: {
        create: {
          logoUrl: null,
          primaryColor: "#0f766e",
          widgetTitle: "Kai",
          welcomeMessage: "Hi, I am Kai. How can I help with your booking?",
          brandVoice: "Warm, concise, practical, and grounded in tenant data."
        }
      },
      config: {
        create: {
          supportedChannels: ["WEB_WIDGET"],
          enabledFeatures: ["widget_config", "mock_pms"],
          requiredSlots: {
            instantBooking: ["productId", "date", "guests", "travellerName", "travellerEmail"],
            inquiry: ["productId", "date", "guests", "travellerName", "travellerEmail", "notes"]
          },
          bookingMode: "MANUAL_INQUIRY",
          pmsProvider: "MOCK",
          escalationRules: ["human_requested", "custom_quote", "safety_or_refund"],
          responseGuardrails: [
            "Do not invent availability.",
            "Do not invent final prices.",
            "Do not confirm a booking without a booking tool result."
          ]
        }
      }
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
