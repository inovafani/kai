import type { BookingMode, PmsProvider } from "@/core/tenant/types";

interface WidgetTenantInput {
  id: string;
  slug: string;
  name: string;
  defaultLocale: string;
  branding: {
    logoUrl: string | null;
    primaryColor: string;
    widgetTitle: string;
    welcomeMessage: string;
    brandVoice: string;
  } | null;
  config: {
    supportedChannels: string[];
    enabledFeatures: string[];
    bookingMode: string;
    pmsProvider: PmsProvider;
  } | null;
}

export function toPublicWidgetConfig(tenant: WidgetTenantInput) {
  return {
    tenant: {
      slug: tenant.slug,
      name: tenant.name,
      defaultLocale: tenant.defaultLocale
    },
    branding: {
      logoUrl: tenant.branding?.logoUrl ?? null,
      primaryColor: tenant.branding?.primaryColor ?? "#0f766e",
      widgetTitle: tenant.branding?.widgetTitle ?? tenant.name,
      welcomeMessage: tenant.branding?.welcomeMessage ?? "Hi, I am Kai. How can I help?"
    },
    capabilities: {
      supportedChannels: tenant.config?.supportedChannels ?? ["WEB_WIDGET"],
      enabledFeatures: tenant.config?.enabledFeatures ?? [],
      bookingMode: (tenant.config?.bookingMode ?? "MANUAL_INQUIRY") as BookingMode,
      pmsProvider: tenant.config?.pmsProvider ?? "MOCK"
    }
  };
}
