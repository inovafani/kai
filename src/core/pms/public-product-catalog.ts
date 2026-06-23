import type { PublicProductMapping } from "./mapped-pms-adapter";
import type { PmsExtraOption } from "./types";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function readString(record: UnknownRecord, key: string) {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(record: UnknownRecord, key: string) {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);

  return 0;
}

function parseExtraOptions(value: unknown): PmsExtraOption[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const options = value
    .map((item) => {
      const record = asRecord(item);
      if (!record) return null;

      const label = readString(record, "label") || readString(record, "name") || readString(record, "title");
      const unitPriceCents =
        readNumber(record, "unitPriceCents") || Math.round(readNumber(record, "price") * 100);

      return label ? { label, unitPriceCents } : null;
    })
    .filter((item): item is PmsExtraOption => Boolean(item));

  return options.length > 0 ? options : undefined;
}

function normalizeBookingMode(value: string) {
  return value === "MANUAL_INQUIRY" ? "MANUAL_INQUIRY" : "AUTO_BOOKING";
}

export function parsePublicProductCatalog(value: unknown): PublicProductMapping[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const record = asRecord(item);
      if (!record) return null;

      const publicTitle = readString(record, "publicTitle");
      const pmsProductId = readString(record, "pmsProductId");
      const publicDescription = readString(record, "publicDescription");
      const productUrl = readString(record, "productUrl");
      const bookingMode = readString(record, "bookingMode");
      const extraOptions = parseExtraOptions(record.extraOptions);

      if (!publicTitle || !pmsProductId) {
        return null;
      }

      const mapping: PublicProductMapping = {
        publicTitle,
        publicDescription,
        ...(productUrl ? { productUrl } : {}),
        pmsProductId,
        bookingMode: normalizeBookingMode(bookingMode),
        ...(extraOptions ? { extraOptions } : {})
      };

      return mapping;
    })
    .filter((item): item is PublicProductMapping => item !== null);
}

export function parsePublicProductCatalogJson(value: string): PublicProductMapping[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  return parsePublicProductCatalog(JSON.parse(trimmed));
}

export function parsePublicProductCatalogRows(input: {
  publicTitles: string[];
  publicDescriptions: string[];
  productUrls?: string[];
  pmsProductIds: string[];
  bookingModes: string[];
}): PublicProductMapping[] {
  const maxLength = Math.max(
    input.publicTitles.length,
    input.publicDescriptions.length,
    input.productUrls?.length ?? 0,
    input.pmsProductIds.length,
    input.bookingModes.length
  );

  return parsePublicProductCatalog(
    Array.from({ length: maxLength }, (_, index) => ({
      publicTitle: input.publicTitles[index] ?? "",
      publicDescription: input.publicDescriptions[index] ?? "",
      productUrl: input.productUrls?.[index] ?? "",
      pmsProductId: input.pmsProductIds[index] ?? "",
      bookingMode: input.bookingModes[index] ?? "AUTO_BOOKING"
    }))
  );
}
