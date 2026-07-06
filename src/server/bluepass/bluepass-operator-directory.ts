import type { BluePassSelectedYachtInput } from "./bluepass-inquiry-repository";

type BluePassOperatorDirectoryEntry = {
  operatorSlug?: string | null;
  operatorName?: string | null;
  yachtSlugs?: string[] | null;
  whatsappPhone?: string | null;
};

type BluePassOperatorDirectoryResponse = {
  operators?: BluePassOperatorDirectoryEntry[];
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
    const response = await fetch(`${baseUrl}/api/kai/operator-directory`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      },
      cache: "no-store"
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as BluePassOperatorDirectoryResponse;
    const match = payload.operators?.find((operator) => operatorMatchesSelectedYacht(operator, selectedYacht));

    return normalizePhone(match?.whatsappPhone);
  } catch {
    return null;
  }
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
