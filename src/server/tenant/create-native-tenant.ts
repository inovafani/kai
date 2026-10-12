import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { BLUEPASS_STRIPE_PMS_CHECKOUT_FEATURE, WHATSAPP_GENERIC_ELIGIBLE_FEATURE } from "@/core/tenant/feature-flags";
import { prisma } from "@/lib/prisma";

/** Features that make a native tenant visible to travellers. Held back until the operator is ready to take bookings. */
export const NATIVE_GO_LIVE_FEATURES = [WHATSAPP_GENERIC_ELIGIBLE_FEATURE, BLUEPASS_STRIPE_PMS_CHECKOUT_FEATURE];

const NATIVE_ALLOWED_ORIGINS = ["https://bluepass.co", "https://www.bluepass.co"];

const REQUIRED_SLOTS = {
  instantBooking: ["productId", "date", "guests", "travellerName", "travellerEmail"],
  inquiry: ["productId", "date", "guests", "travellerName", "travellerEmail", "notes"]
};

const RESPONSE_GUARDRAILS = [
  "Do not invent availability.",
  "Do not invent final prices.",
  "Do not confirm a booking without a booking tool result."
];

export interface CreateNativeTenantInput {
  /** The BluePass operator profile id. Asking twice with the same id returns the same tenant. */
  externalOperatorId: string;
  name: string;
  /** The operator's own WhatsApp number, where accept and decline requests arrive. */
  adminWhatsAppPhone?: string | null;
  /** Add the features that make the tenant bookable by travellers. Off until the operator is ready. */
  goLive?: boolean;
}

export function slugifyOperatorName(name: string) {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "operator";
}

/** E.164 digits without the plus, the shape the WhatsApp sender expects. Null when it cannot be a phone number. */
export function normalizeWhatsAppDigits(phone: string | null | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function buildNativeTenantData(input: { slug: string; name: string; adminWhatsAppPhone: string | null; goLive: boolean }) {
  return {
    slug: input.slug,
    name: input.name,
    widgetPublicKey: `pk_native_${randomBytes(12).toString("hex")}`,
    allowedOrigins: NATIVE_ALLOWED_ORIGINS,
    defaultLocale: "en",
    status: "ACTIVE" as const,
    branding: {
      primaryColor: "#0f766e",
      widgetTitle: "Kai",
      welcomeMessage: `Hi, I'm Kai. Ask me about ${input.name} and I'll check live times and seats.`,
      brandVoice: "Warm, concise, practical and grounded in the operator's own trips."
    },
    config: {
      supportedChannels: ["WEB_WIDGET"],
      enabledFeatures: input.goLive ? [...NATIVE_GO_LIVE_FEATURES] : [],
      requiredSlots: REQUIRED_SLOTS,
      bookingMode: "AUTO_BOOKING",
      bookingWriteEnabled: true,
      pmsProvider: "NATIVE" as const,
      escalationRules: ["large_group", "wedding_or_corporate_event", "human_requested"],
      responseGuardrails: RESPONSE_GUARDRAILS,
      adminWhatsAppPhone: input.adminWhatsAppPhone
    }
  };
}

type TenantResult = { slug: string; name: string; widgetPublicKey: string; enabledFeatures: string[]; created: boolean };

function toResult(
  tenant: { slug: string; name: string; widgetPublicKey: string; config: { enabledFeatures: string[] } | null },
  created: boolean
): TenantResult {
  return {
    slug: tenant.slug,
    name: tenant.name,
    widgetPublicKey: tenant.widgetPublicKey,
    enabledFeatures: tenant.config?.enabledFeatures ?? [],
    created
  };
}

async function findByOperator(externalOperatorId: string) {
  return prisma.tenant.findUnique({
    where: { externalOperatorId },
    select: { id: true, slug: true, name: true, widgetPublicKey: true, config: { select: { enabledFeatures: true } } }
  });
}

/**
 * Creates the Kai tenant for a BluePass operator, or returns the one that already exists for that
 * operator. Idempotent on externalOperatorId, so the onboarding flow and the approval flow can both
 * call it without creating two tenants. A repeat call with goLive turns the traveller-facing
 * features on (it never turns them off) and refreshes the operator's WhatsApp number.
 */
export async function createNativeTenant(input: CreateNativeTenantInput): Promise<TenantResult> {
  const goLive = Boolean(input.goLive);
  const adminWhatsAppPhone = normalizeWhatsAppDigits(input.adminWhatsAppPhone);
  const existing = await findByOperator(input.externalOperatorId);

  if (existing) {
    const features = new Set(existing.config?.enabledFeatures ?? []);
    if (goLive) NATIVE_GO_LIVE_FEATURES.forEach((feature) => features.add(feature));

    const updated = await prisma.tenant.update({
      where: { id: existing.id },
      data: {
        config: {
          update: {
            enabledFeatures: [...features],
            ...(adminWhatsAppPhone ? { adminWhatsAppPhone } : {})
          }
        }
      },
      select: { slug: true, name: true, widgetPublicKey: true, config: { select: { enabledFeatures: true } } }
    });
    return toResult(updated, false);
  }

  const baseSlug = slugifyOperatorName(input.name);
  // Two operators can share a name, so a taken slug gets a short, stable suffix from the operator id.
  const slugCandidates = [baseSlug, `${baseSlug}-${input.externalOperatorId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-6) || "op"}`];

  for (const slug of slugCandidates) {
    const data = buildNativeTenantData({ slug, name: input.name.trim(), adminWhatsAppPhone, goLive });
    try {
      const tenant = await prisma.tenant.create({
        data: {
          slug: data.slug,
          name: data.name,
          widgetPublicKey: data.widgetPublicKey,
          allowedOrigins: data.allowedOrigins,
          defaultLocale: data.defaultLocale,
          status: data.status,
          externalOperatorId: input.externalOperatorId,
          branding: { create: data.branding },
          config: { create: data.config }
        },
        select: { slug: true, name: true, widgetPublicKey: true, config: { select: { enabledFeatures: true } } }
      });
      return toResult(tenant, true);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      // Lost a race for the same operator: the other request's tenant is the answer.
      const raced = await findByOperator(input.externalOperatorId);
      if (raced) return toResult(raced, false);
      // Otherwise the slug was taken by someone else, so try the suffixed one.
    }
  }

  throw new Error("Could not find a free tenant slug for this operator.");
}
