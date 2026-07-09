import type { BluePassSelectedYachtInput } from "./bluepass-inquiry-repository";

type BluePassOperatorDirectoryEntry = {
  operatorSlug?: string | null;
  operatorName?: string | null;
  yachtSlugs?: string[] | null;
  whatsappPhone?: string | null;
  status?: string | null;
  source?: string | null;
};

type BluePassOperatorDirectoryResponse = {
  operators?: BluePassOperatorDirectoryEntry[];
};

type BluePassPartnerDirectoryEntry = {
  partnerId?: string | null;
  partnerName?: string | null;
  partnerRole?: string | null;
  handle?: string | null;
  whatsappPhone?: string | null;
  status?: string | null;
  source?: string | null;
};

type BluePassPartnerDirectoryResponse = {
  partners?: BluePassPartnerDirectoryEntry[];
};

export async function resolveBluePassOperatorDirectoryPhone(input: {
  selectedYacht?: BluePassSelectedYachtInput | null;
}) {
  const selectedYacht = input.selectedYacht;
  if (!selectedYacht) return null;

  const baseUrl = resolveBluePassAppUrl();
  const token = resolveBluePassAppServiceToken();
  if (!baseUrl || !token) return null;

  try {
    const payload = await fetchBluePassOperatorDirectory(baseUrl, token);
    const match = payload.operators?.find((operator) => operatorMatchesSelectedYacht(operator, selectedYacht));

    return normalizePhone(match?.whatsappPhone);
  } catch {
    return null;
  }
}

export async function resolveBluePassOperatorDirectoryIdentityByPhone(phone: string) {
  const baseUrl = resolveBluePassAppUrl();
  const token = resolveBluePassAppServiceToken();
  if (!baseUrl || !token) return null;

  try {
    const payload = await fetchBluePassOperatorDirectory(baseUrl, token);
    const normalizedPhone = normalizePhoneForCompare(phone);
    const match = payload.operators?.find((operator) => {
      const operatorPhone = normalizePhoneForCompare(operator.whatsappPhone);

      return operatorPhone.length > 0 && operatorPhone === normalizedPhone;
    });

    return match
      ? {
          persona: "OPERATOR" as const,
          operatorName: match.operatorName?.trim() || match.operatorSlug?.trim() || null,
          operatorSlug: match.operatorSlug?.trim() || null,
          yachtSlugs: match.yachtSlugs ?? []
        }
      : null;
  } catch {
    return null;
  }
}

export async function resolveBluePassPartnerDirectoryIdentityByPhone(phone: string) {
  const baseUrl = resolveBluePassAppUrl();
  const token = resolveBluePassAppServiceToken();
  if (!baseUrl || !token) return null;

  try {
    const payload = await fetchBluePassPartnerDirectory(baseUrl, token);
    const normalizedPhone = normalizePhoneForCompare(phone);
    const match = payload.partners?.find((partner) => {
      const partnerPhone = normalizePhoneForCompare(partner.whatsappPhone);

      return partnerPhone.length > 0 && partnerPhone === normalizedPhone;
    });

    return match
      ? {
          persona: "PARTNER" as const,
          partnerName: match.partnerName?.trim() || match.handle?.trim() || match.partnerId?.trim() || null,
          partnerId: match.partnerId?.trim() || null,
          partnerRole: match.partnerRole?.trim() || null,
          handle: match.handle?.trim() || null
        }
      : null;
  } catch {
    return null;
  }
}

async function fetchBluePassOperatorDirectory(
  baseUrl: string,
  token: string
): Promise<BluePassOperatorDirectoryResponse> {
  const response = await fetch(`${baseUrl}/api/kai/operator-directory`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) return {};

  return (await response.json()) as BluePassOperatorDirectoryResponse;
}

async function fetchBluePassPartnerDirectory(baseUrl: string, token: string): Promise<BluePassPartnerDirectoryResponse> {
  const response = await fetch(`${baseUrl}/api/kai/partner-directory`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) return {};

  return (await response.json()) as BluePassPartnerDirectoryResponse;
}

function operatorMatchesSelectedYacht(
  operator: BluePassOperatorDirectoryEntry,
  selectedYacht: BluePassSelectedYachtInput
) {
  const selectedKeys = buildSelectedYachtKeys(selectedYacht);
  const operatorKeys = buildOperatorDirectoryKeys(operator);

  return selectedKeys.some((key) => operatorKeys.includes(key));
}

function buildSelectedYachtKeys(selectedYacht: BluePassSelectedYachtInput) {
  return uniqueKeys([
    selectedYacht.slug,
    selectedYacht.name,
    selectedYacht.operatorId,
    stripOperatorPrefix(selectedYacht.operatorId),
    selectedYacht.operatorName
  ]);
}

function buildOperatorDirectoryKeys(operator: BluePassOperatorDirectoryEntry) {
  return uniqueKeys([operator.operatorSlug, operator.operatorName, ...(operator.yachtSlugs ?? [])]);
}

function stripOperatorPrefix(value?: string | null) {
  return value?.replace(/^operator[_-]/i, "") ?? null;
}

function uniqueKeys(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => normalizeMatchKey(value)).filter((value): value is string => Boolean(value)))
  );
}

function normalizeMatchKey(value?: string | null) {
  return value
    ?.toLowerCase()
    .replace(/^operator[_-]/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizePhone(value?: string | null) {
  return value?.trim() || null;
}

function normalizePhoneForCompare(value?: string | null) {
  const digits = value?.trim().replace(/[^\d]/g, "") ?? "";
  return digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
}

function resolveBluePassAppUrl() {
  const raw = process.env.BLUEPASS_APP_URL ?? process.env.NEXT_PUBLIC_BLUEPASS_APP_URL;
  return raw?.trim().replace(/\/+$/g, "") || null;
}

function resolveBluePassAppServiceToken() {
  return (
    process.env.BLUEPASS_APP_SERVICE_TOKEN?.trim() ||
    process.env.KAI_ADMIN_TOKEN?.trim() ||
    process.env.KAI_CORE_ADMIN_TOKEN?.trim() ||
    null
  );
}
