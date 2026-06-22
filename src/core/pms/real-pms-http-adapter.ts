import type {
  PmsAdapter,
  PmsAvailabilityRequest,
  PmsAvailabilityResult,
  PmsCreateBookingRequest,
  PmsCreateBookingResult,
  PmsProduct
} from "./types";
import type { PmsProvider } from "@/core/tenant/types";

export const REAL_PMS_NOT_CONNECTED_MESSAGE =
  "Real PMS adapter is configured but credentials/API mapping are not connected yet.";

type Fetcher = typeof fetch;

type UnknownRecord = Record<string, unknown>;

export interface RealPmsHttpAdapterConfig {
  baseUrl?: string;
  apiKey?: string;
  apiKeyPlacement?: "bearer" | "query";
  productListPath?: string;
  availabilityPath?: string;
  bookingPath?: string;
  timeoutMs?: number;
  fetcher?: Fetcher;
}

export abstract class RealPmsHttpAdapter implements PmsAdapter {
  abstract provider: PmsProvider;

  protected readonly config: RealPmsHttpAdapterConfig;
  protected readonly fetcher: Fetcher;

  protected constructor(config: RealPmsHttpAdapterConfig = {}) {
    this.config = config;
    this.fetcher = config.fetcher ?? fetch;
  }

  async listProducts(): Promise<PmsProduct[]> {
    this.assertConfigured(["baseUrl", "apiKey", "productListPath"]);
    const payload = await this.requestJson("GET", this.config.productListPath as string);
    return this.extractProductRecords(payload).map((record) => this.mapProduct(record));
  }

  async getAvailability(request: PmsAvailabilityRequest): Promise<PmsAvailabilityResult> {
    this.assertConfigured(["baseUrl", "apiKey", "availabilityPath"]);
    const payload = await this.requestJson("POST", this.config.availabilityPath as string, request);
    return this.mapAvailability(this.asRecord(payload), request);
  }

  async createBooking(_request: PmsCreateBookingRequest): Promise<PmsCreateBookingResult> {
    this.notConnected("createBooking");
  }

  async cancelBooking(_externalBookingId: string): Promise<{ cancelled: boolean }> {
    this.notConnected("cancelBooking");
  }

  async getBooking(_externalBookingId: string): Promise<PmsCreateBookingResult | null> {
    this.notConnected("getBooking");
  }

  protected notConnected(operation?: string): never {
    const suffix = operation ? ` ${operation}` : "";
    throw new Error(`${this.provider} PMS adapter${suffix} is not enabled until booking-write API mapping is configured.`);
  }

  protected assertConfigured(keys: Array<keyof RealPmsHttpAdapterConfig>) {
    const missing = keys.filter((key) => !String(this.config[key] ?? "").trim());

    if (missing.length > 0) {
      throw new Error(`${this.provider} PMS adapter requires ${keys.join(", ").replace(/, ([^,]*)$/, ", and $1")} before live calls.`);
    }
  }

  protected async requestJson(method: "GET" | "POST", path: string, body?: unknown, query?: Record<string, string>) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.config.timeoutMs ?? 5000);

    try {
      const response = await this.fetcher(this.buildUrl(path, query), {
        method,
        headers: this.buildHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: abortController.signal
      });

      if (!response.ok) {
        const responseText = await response.text();
        const detail = responseText.trim().slice(0, 500);
        throw new Error(
          `${this.provider} PMS API request failed with status ${response.status}${detail ? `: ${detail}` : "."}`
        );
      }

      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildUrl(path: string, query?: Record<string, string>) {
    const baseUrl = String(this.config.baseUrl).replace(/\/$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${baseUrl}${normalizedPath}`);

    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }

    if (this.config.apiKeyPlacement === "query") {
      url.searchParams.set("apiKey", String(this.config.apiKey));
    }

    return url.toString();
  }

  private buildHeaders() {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json"
    };

    if (this.config.apiKeyPlacement !== "query") {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  private extractProductRecords(payload: unknown): UnknownRecord[] {
    if (Array.isArray(payload)) {
      return payload.map((item) => this.asRecord(item));
    }

    const record = this.asRecord(payload);
    const products = record.products ?? record.items ?? record.data;

    if (!Array.isArray(products)) {
      throw new Error(`${this.provider} PMS product response did not include a product array.`);
    }

    return products.map((item) => this.asRecord(item));
  }

  protected asRecord(value: unknown): UnknownRecord {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${this.provider} PMS response was not a JSON object.`);
    }

    return value as UnknownRecord;
  }

  protected mapProduct(record: UnknownRecord): PmsProduct {
    const externalProductId = this.readString(record, ["externalProductId", "productCode", "id", "productId", "uuid"]);
    const title = this.readString(record, ["title", "name", "productName"]);
    const description = this.readOptionalString(record, ["description", "summary", "shortDescription"]) ?? "";
    const bookingMode = this.readOptionalString(record, ["bookingMode", "booking_mode"]);

    return {
      externalProductId,
      title,
      description,
      bookingMode: bookingMode === "MANUAL_INQUIRY" ? "MANUAL_INQUIRY" : "AUTO_BOOKING"
    };
  }

  protected mapAvailability(record: UnknownRecord, fallback: PmsAvailabilityRequest): PmsAvailabilityResult {
    return {
      productId: this.readOptionalString(record, ["productId", "externalProductId", "productCode"]) ?? fallback.productId,
      date: this.readOptionalString(record, ["date", "travelDate", "startDate"]) ?? fallback.date,
      available: this.readBoolean(record, ["available", "isAvailable"]),
      remaining: this.readNumber(record, ["remaining", "spotsRemaining", "availability"]),
      currency: this.readOptionalString(record, ["currency", "currencyCode"]) ?? "USD",
      unitPriceCents: this.readNumber(record, ["unitPriceCents", "priceCents", "adultPriceCents"])
    };
  }

  protected readString(record: UnknownRecord, keys: string[]) {
    const value = this.readOptionalString(record, keys);

    if (!value) {
      throw new Error(`${this.provider} PMS response is missing required field: ${keys.join("/")}.`);
    }

    return value;
  }

  protected readOptionalString(record: UnknownRecord, keys: string[]) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
      if (typeof value === "number") {
        return String(value);
      }
    }

    return null;
  }

  protected readNumber(record: UnknownRecord, keys: string[]) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
        return Number(value);
      }
    }

    throw new Error(`${this.provider} PMS response is missing required numeric field: ${keys.join("/")}.`);
  }

  protected readBoolean(record: UnknownRecord, keys: string[]) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "boolean") {
        return value;
      }
      if (typeof value === "string") {
        if (value.toLowerCase() === "true") return true;
        if (value.toLowerCase() === "false") return false;
      }
    }

    throw new Error(`${this.provider} PMS response is missing required boolean field: ${keys.join("/")}.`);
  }
}
