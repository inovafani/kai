import { RealPmsHttpAdapter, type RealPmsHttpAdapterConfig } from "./real-pms-http-adapter";
import type {
  PmsAvailabilityRequest,
  PmsAvailabilityResult,
  PmsCreateBookingRequest,
  PmsCreateBookingResult
} from "./types";

type UnknownRecord = Record<string, unknown>;

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function resolveRezdyDateRange(dateText: string) {
  const lowerDateText = dateText.toLowerCase();
  const explicitDate = dateText.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  const startDate = explicitDate
    ? new Date(`${explicitDate}T00:00:00.000Z`)
    : addDays(new Date(), lowerDateText.includes("tomorrow") ? 1 : 0);
  const normalizedStartDate = `${formatDate(startDate)} 00:00:00`;
  const normalizedEndDate = `${formatDate(addDays(startDate, 1))} 00:00:00`;

  return {
    startTimeLocal: normalizedStartDate,
    endTimeLocal: normalizedEndDate
  };
}

function asRecord(value: unknown): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as UnknownRecord;
}

function readNumber(record: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }

  return 0;
}

function readString(record: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }

  return "";
}

function splitTravellerName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const firstName = parts.shift() ?? name.trim();
  const lastName = parts.length > 0 ? parts.join(" ") : "-";

  return { firstName, lastName };
}

function readNestedRecord(record: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as UnknownRecord;
    }
  }

  return record;
}

function readArrayRecords(record: UnknownRecord, key: string) {
  const value = record[key];

  return Array.isArray(value) ? value.map(asRecord) : [];
}

function readPriceOptionLabel(priceOption: UnknownRecord | undefined) {
  if (!priceOption) return "";

  return readString(priceOption, ["label", "optionLabel", "name", "title"]);
}

function readExtraOptionLabel(extraOption: UnknownRecord | undefined) {
  if (!extraOption) return "";

  return readString(extraOption, ["label", "optionLabel", "name", "title"]);
}

function readExtraOptionPrice(extraOption: UnknownRecord) {
  return readNumber(extraOption, ["unitPrice", "price", "advertisedPrice", "amount", "value"]);
}

function scorePriceOption(priceOption: UnknownRecord) {
  const label = readPriceOptionLabel(priceOption).toLowerCase();

  if (/\badult\b/.test(label)) return 100;
  if (/\bsingle\b/.test(label)) return 70;
  if (/\bperson\b/.test(label)) return 50;
  if (/\bpeople\b/.test(label)) return 30;
  if (/\bchild\b|\binfant\b|\bfamily\b|\bsenior\b|\bstudent\b/.test(label)) return -100;

  return 10;
}

function selectPriceOption(priceOptions: UnknownRecord[]) {
  return priceOptions
    .map((priceOption, index) => ({ priceOption, index, score: scorePriceOption(priceOption) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.priceOption;
}

function isRezdyLocalDateTime(dateText: string) {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateText.trim());
}

function formatRezdyTimeLabel(startTimeLocal: string) {
  const match = startTimeLocal.match(/\b(\d{2}):(\d{2}):\d{2}\b/);
  if (!match) return startTimeLocal;

  const hour24 = Number(match[1]);
  const minute = match[2];
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;

  return `${hour12}:${minute} ${period}`;
}

interface RezdyAvailabilitySession {
  dateRange: ReturnType<typeof resolveRezdyDateRange>;
  session?: UnknownRecord;
  sessions: UnknownRecord[];
}

export class RezdyPmsAdapter extends RealPmsHttpAdapter {
  provider = "REZDY" as const;

  constructor(config: RealPmsHttpAdapterConfig = {}) {
    super({ ...config, apiKeyPlacement: config.apiKeyPlacement ?? "query" });
  }

  async getAvailability(request: PmsAvailabilityRequest): Promise<PmsAvailabilityResult> {
    const { dateRange, session, sessions } = await this.findAvailabilitySession(request);

    if (!session) {
      return {
        productId: request.productId,
        date: dateRange.startTimeLocal,
        available: false,
        remaining: 0,
        currency: "AUD",
        unitPriceCents: 0
      };
    }

    const priceOptions = readArrayRecords(session, "priceOptions");
    const selectedPrice = selectPriceOption(priceOptions);
    const unitPrice = selectedPrice ? readNumber(selectedPrice, ["price", "adultPrice", "advertisedPrice"]) : 0;
    const remaining = readNumber(session, ["seatsAvailable", "availability", "remaining"]);
    const timeOptions = sessions
      .filter((item) => readNumber(item, ["seatsAvailable", "availability", "remaining"]) >= request.guests)
      .map((item) => {
        const startTimeLocal = readString(item, ["startTimeLocal", "startTime"]);
        const checkoutItemKey = readString(item, ["itemKey"]);
        const checkoutSessionId = readString(item, ["id", "sessionId", "sessionKey", "availabilityId"]);

        return startTimeLocal
          ? {
              label: formatRezdyTimeLabel(startTimeLocal),
              startTimeLocal,
              remaining: readNumber(item, ["seatsAvailable", "availability", "remaining"]),
              ...(checkoutItemKey ? { checkoutItemKey } : {}),
              ...(checkoutSessionId ? { checkoutSessionId } : {})
            }
          : null;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const ticketOptions = priceOptions
      .map((priceOption) => ({
        label: readPriceOptionLabel(priceOption),
        unitPriceCents: Math.round(readNumber(priceOption, ["price", "adultPrice", "advertisedPrice"]) * 100)
      }))
      .filter((ticketOption) => ticketOption.label);
    const sessionExtraOptions = ["extras", "extraOptions", "productExtras"]
      .flatMap((key) => readArrayRecords(session, key))
      .map((extraOption) => ({
        label: readExtraOptionLabel(extraOption),
        unitPriceCents: Math.round(readExtraOptionPrice(extraOption) * 100)
      }))
      .filter((extraOption) => extraOption.label);
    const productExtraOptions =
      sessionExtraOptions.length > 0 ? [] : await this.findProductExtraOptions(request.productId);
    const extraOptions = sessionExtraOptions.length > 0 ? sessionExtraOptions : productExtraOptions;

    return {
      productId: readString(session, ["productCode", "productId"]) || request.productId,
      date: readString(session, ["startTimeLocal", "startTime"]) || dateRange.startTimeLocal,
      available: remaining >= request.guests,
      remaining,
      currency: readString(session, ["currency", "currencyCode"]) || "AUD",
      unitPriceCents: Math.round(unitPrice * 100),
      timeOptions,
      ticketOptions,
      ...(extraOptions.length > 0 ? { extraOptions } : {})
    };
  }

  private async findProductExtraOptions(productId: string) {
    if (!this.config.productListPath) return [];

    let product: UnknownRecord | undefined;
    try {
      const payload = await this.requestJson("GET", this.config.productListPath);
      const record = asRecord(payload);
      const products = readArrayRecords(record, "products");
      product = products.find((item) => readString(item, ["productCode", "productId", "id"]) === productId);
    } catch {
      return [];
    }

    if (!product) return [];

    return ["extras", "extraOptions", "productExtras"]
      .flatMap((key) => readArrayRecords(product, key))
      .map((extraOption) => ({
        label: readExtraOptionLabel(extraOption),
        unitPriceCents: Math.round(readExtraOptionPrice(extraOption) * 100)
      }))
      .filter((extraOption) => extraOption.label);
  }

  async createBooking(request: PmsCreateBookingRequest): Promise<PmsCreateBookingResult> {
    this.assertConfigured(["baseUrl", "apiKey", "bookingPath"]);
    const availabilitySession = isRezdyLocalDateTime(request.date)
      ? undefined
      : await this.findAvailabilitySession({
          productId: request.productId,
          date: request.date,
          guests: request.guests
        });
    const session = availabilitySession?.session;
    const remaining = session ? readNumber(session, ["seatsAvailable", "availability", "remaining"]) : 0;
    if (availabilitySession && (!session || remaining < request.guests)) {
      return {
        externalBookingId: "",
        provider: this.provider,
        status: "FAILED"
      };
    }

    const priceOptions = session ? readArrayRecords(session, "priceOptions") : [];
    const selectedPrice = selectPriceOption(priceOptions);
    const selectedPriceLabel = readPriceOptionLabel(selectedPrice) || "Adult";
    const ticketQuantities =
      request.ticketQuantities && request.ticketQuantities.length > 0
        ? request.ticketQuantities.map((ticket) => ({
            optionLabel: ticket.optionLabel,
            value: ticket.quantity
          }))
        : [
            {
              optionLabel: selectedPriceLabel,
              value: request.guests
            }
          ];
    const extraQuantities =
      request.extraQuantities && request.extraQuantities.length > 0
        ? request.extraQuantities.map((extra) => ({
            name: extra.optionLabel,
            quantity: extra.quantity
          }))
        : undefined;
    const name = splitTravellerName(request.travellerName);
    const payload = await this.requestJson("POST", this.config.bookingPath as string, {
      ...(request.confirmationMode === "PAYMENT_HOLD" ? { status: "PROCESSING" } : {}),
      customer: {
        firstName: name.firstName,
        lastName: name.lastName,
        email: request.travellerEmail,
        phone: request.travellerPhone ?? ""
      },
      items: [
        {
          productCode: (session ? readString(session, ["productCode", "productId"]) : "") || request.productId,
          startTimeLocal: (session ? readString(session, ["startTimeLocal", "startTime"]) : "") || request.date,
          quantities: ticketQuantities,
          ...(extraQuantities ? { extras: extraQuantities } : {})
        }
      ],
      ...(request.paymentCardToken ? { creditCard: { cardToken: request.paymentCardToken } } : {}),
      resellerComments: "Created by Kai after traveller confirmation."
    });
    const record = asRecord(payload);
    const bookingRecord = readNestedRecord(record, ["order", "booking"]);
    const externalBookingId = readString(bookingRecord, [
      "orderNumber",
      "bookingNumber",
      "confirmationNumber",
      "id",
      "orderId"
    ]);
    const rawStatus = readString(bookingRecord, ["status", "bookingStatus", "orderStatus"]).toUpperCase();
    const paymentUrl =
      readString(bookingRecord, ["paymentUrl", "paymentLink", "paymentPageUrl", "orderPaymentUrl", "paymentRequestUrl"]) ||
      readString(record, ["paymentUrl", "paymentLink", "paymentPageUrl", "orderPaymentUrl", "paymentRequestUrl"]);
    const status =
      !externalBookingId
        ? "FAILED"
        : rawStatus.includes("FAIL") || rawStatus.includes("CANCEL")
        ? "FAILED"
        : rawStatus.includes("PROCESS") || rawStatus.includes("PEND") || rawStatus.includes("UNPAID")
          ? "PENDING"
          : "CONFIRMED";

    return {
      externalBookingId,
      provider: this.provider,
      status,
      ...(paymentUrl ? { paymentUrl } : {})
    };
  }

  private async findAvailabilitySession(request: PmsAvailabilityRequest): Promise<RezdyAvailabilitySession> {
    this.assertConfigured(["baseUrl", "apiKey", "availabilityPath"]);
    const dateRange = resolveRezdyDateRange(request.date);
    const payload = await this.requestJson("GET", this.config.availabilityPath as string, undefined, {
      productCode: request.productId,
      startTimeLocal: dateRange.startTimeLocal,
      endTimeLocal: dateRange.endTimeLocal,
      minAvailability: String(request.guests)
    });
    const record = asRecord(payload);
    const sessions = readArrayRecords(record, "sessions");
    const session =
      sessions.find((item) => readNumber(item, ["seatsAvailable", "availability", "remaining"]) >= request.guests) ??
      sessions[0];

    return { dateRange, session, sessions };
  }
}
