export type TenantStatus = "ACTIVE" | "SUSPENDED" | "DISABLED";

export type BookingMode = "MANUAL_INQUIRY" | "INSTANT_BOOKING";

export type PmsProvider = "MOCK" | "REZDY" | "INSEANQ" | "FAREHARBOR" | "BOKUN" | "NATIVE";

export interface TenantBranding {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  widgetTitle: string;
  welcomeMessage: string;
  brandVoice: string;
}

export interface TenantConfig {
  supportedChannels: Array<"WEB_WIDGET" | "WHATSAPP">;
  enabledFeatures: string[];
  requiredSlots: Record<string, string[]>;
  bookingMode: BookingMode;
  escalationRules: string[];
  responseGuardrails: string[];
}

export interface BusinessPack {
  tenantId: string;
  slug: string;
  status: TenantStatus;
  allowedOrigins: string[];
  branding: TenantBranding;
  config: TenantConfig;
  pmsProvider: PmsProvider;
}
