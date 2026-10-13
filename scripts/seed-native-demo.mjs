// Local test fixture for the native booking system (PmsProvider NATIVE).
//   node --env-file=.env --env-file=.env.local scripts/seed-native-demo.mjs          create or refresh
//   node --env-file=.env --env-file=.env.local scripts/seed-native-demo.mjs remove   delete everything it made
//
// There is no separate test database, so this writes to the same database production uses. It is kept
// safe by being isolated: the tenant carries only the checkout feature, never whatsapp_generic_eligible,
// so it cannot show up in WhatsApp or the Australian recommendation. Removing the tenant cascades to
// its trips, departures, bookings and conversations.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SLUG = "native-demo";
const KEY = "pk_test_native_demo";

async function remove() {
  // Payment attempts (and their ledger lines) are not removed by deleting the tenant, so clear them first.
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (tenant) {
    await prisma.pmsBookingLedgerEntry.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.pmsBookingPaymentAttempt.deleteMany({ where: { tenantId: tenant.id } });
  }
  const { count } = await prisma.tenant.deleteMany({ where: { slug: SLUG } });
  console.log(count ? "Removed the native demo tenant and everything under it." : "Nothing to remove.");
}

async function seed() {
  const config = {
    supportedChannels: ["WEB_WIDGET"],
    enabledFeatures: ["bluepass_stripe_pms_checkout"],
    requiredSlots: {
      instantBooking: ["productId", "date", "guests", "travellerName", "travellerEmail"],
      inquiry: ["productId", "date", "guests", "travellerName", "travellerEmail", "notes"]
    },
    bookingMode: "AUTO_BOOKING",
    bookingWriteEnabled: true,
    pmsProvider: "NATIVE",
    escalationRules: ["large_group", "human_requested"],
    responseGuardrails: [
      "Do not invent availability.",
      "Do not invent final prices.",
      "Do not confirm a booking without a booking tool result."
    ]
  };
  const branding = {
    primaryColor: "#0f766e",
    widgetTitle: "Kai",
    welcomeMessage: "Hi, I'm Kai. Ask me about Blue Water Tours and I'll check live times and seats.",
    brandVoice: "Warm, concise and practical."
  };
  const tenant = await prisma.tenant.upsert({
    where: { slug: SLUG },
    update: { status: "ACTIVE" },
    create: {
      slug: SLUG,
      name: "Blue Water Tours (native demo)",
      widgetPublicKey: KEY,
      allowedOrigins: ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3107", "https://kai-six-virid.vercel.app"],
      status: "ACTIVE",
      branding: { create: branding },
      config: { create: config }
    }
  });

  const existing = await prisma.nativeTrip.count({ where: { tenantId: tenant.id } });
  if (existing === 0) {
    const everyDay = [0, 1, 2, 3, 4, 5, 6];
    await prisma.nativeTrip.create({
      data: {
        tenantId: tenant.id,
        title: "Reef Snorkel",
        description: "Two hours on the reef with a guide, gear included.",
        durationMinutes: 120,
        meetingPoint: "Carlisle Bay Marina",
        currency: "USD",
        timeZone: "America/Barbados",
        status: "PUBLISHED",
        ticketTypes: {
          create: [
            { label: "Adult", priceCents: 12000, sortOrder: 0 },
            { label: "Child", priceCents: 6000, sortOrder: 1 },
            { label: "Lunch box", priceCents: 2500, kind: "EXTRA" }
          ]
        },
        schedules: {
          create: [
            { daysOfWeek: everyDay, localTime: "09:00", seats: 6 },
            { daysOfWeek: everyDay, localTime: "14:00", seats: 6 }
          ]
        }
      }
    });
    await prisma.nativeTrip.create({
      data: {
        tenantId: tenant.id,
        title: "Sunset Catamaran",
        description: "A relaxed evening sail along the west coast.",
        durationMinutes: 150,
        meetingPoint: "Carlisle Bay Marina",
        currency: "USD",
        timeZone: "America/Barbados",
        status: "PUBLISHED",
        ticketTypes: { create: [{ label: "Adult", priceCents: 9500 }] },
        schedules: { create: [{ daysOfWeek: [3, 5, 6], localTime: "16:30", seats: 12 }] }
      }
    });
  }
  console.log(`Native demo ready: tenant ${SLUG}, widget key ${KEY}. Open http://localhost:3000/demo/native`);
}

(process.argv[2] === "remove" ? remove() : seed())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
