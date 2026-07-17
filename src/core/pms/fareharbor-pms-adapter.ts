import { RealPmsHttpAdapter, type RealPmsHttpAdapterConfig } from "./real-pms-http-adapter";
import type {
  PmsAvailabilityRequest,
  PmsAvailabilityResult,
  PmsCreateBookingRequest,
  PmsCreateBookingResult,
  PmsProduct,
  PmsTicketOption,
  PmsTimeOption
} from "./types";

/**
 * FareHarbor External API v1 adapter.
 *
 * FareHarbor does NOT fit the single-key bearer/query model of RealPmsHttpAdapter:
 *   - auth is two headers: X-FareHarbor-API-App (app key) + X-FareHarbor-API-User (user key)
 *   - URLs are RESTful with path segments: /companies/<shortname>/items/<pk>/availability/date/<yyyy-mm-dd>/
 *   - pricing is per customer_type_rate, amounts already in the smallest currency unit (cents)
 *   - a booking is created against an availability pk with a customers[] array of customer_type_rate pks
 *
 * So this adapter extends RealPmsHttpAdapter only to reuse its config shape and the read*
 * mapping helpers, and overrides listProducts/getAvailability/createBooking with FareHarbor
 * request building. Like the Rezdy adapter, createBooking re-resolves the availability from
 * productId + date (the booking request carries no availability pk) and maps ticket labels to
 * FareHarbor customer_type_rate pks. Without appKey/userKey/companyShortname it fails closed
 * with an actionable message.
 *
 * STATUS: code-complete + unit-tested against mocked FareHarbor payloads. NOT yet verified
 * against a live FareHarbor account - real credentials + a tenant mapped to FAREHARBOR + an
 * end-to-end availability/booking test is the go-live step owned with Inov.
 * Reference: https://fareharbor.com/api/external/v1/
 */
export interface FareHarborPmsAdapterConfig extends RealPmsHttpAdapterConfig {
  /** FareHarbor External API app key (sent as X-FareHarbor-API-App). */
  appKey?: string;
  /** FareHarbor External API user key (sent as X-FareHarbor-API-User). */
  userKey?: string;
  /** The company shortname that scopes every FareHarbor endpoint (/companies/<shortname>/...). */
  companyShortname?: string;
}

type UnknownRecord = Record<string, unknown>;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

/** Resolve a Kai date string ("2026-07-20", "tomorrow", "today", "") to a FareHarbor yyyy-mm-dd. */
function resolveFareHarborDate(dateText: string, now: Date = new Date()): string {
  const explicit = dateText.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (explicit) return explicit;

  const base = new Date(now);
  if (dateText.toLowerCase().includes("tomorrow")) {
    base.setUTCDate(base.getUTCDate() + 1);
  }

  return `${base.getUTCFullYear()}-${pad2(base.getUTCMonth() + 1)}-${pad2(base.getUTCDate())}`;
}

/** Prefer an adult / per-person rate; de-prioritise child/family/concession for a stable headline price. */
function scoreCustomerTypeName(name: string): number {
  const lower = name.toLowerCase();
  if (/\badult\b/.test(lower)) return 100;
  if (/\bsingle\b/.test(lower)) return 70;
  if (/\bperson\b|\bpp\b/.test(lower)) return 50;
  if (/\bpeople\b|\bgeneral\b/.test(lower)) return 30;
  if (/\bchild\b|\binfant\b|\bfamily\b|\bsenior\b|\bstudent\b|\bconcession\b/.test(lower)) return -100;
  return 10;
}

export class FareHarborPmsAdapter extends RealPmsHttpAdapter {
  provider = "FAREHARBOR" as const;

  protected readonly fhConfig: FareHarborPmsAdapterConfig;

  constructor(config: FareHarborPmsAdapterConfig = {}) {
    super(config);
    this.fhConfig = config;
  }

  private assertFareHarborConfigured() {
    const missing: string[] = [];
    if (!String(this.fhConfig.baseUrl ?? "").trim()) missing.push("baseUrl");
    if (!String(this.fhConfig.appKey ?? "").trim()) missing.push("appKey");
    if (!String(this.fhConfig.userKey ?? "").trim()) missing.push("userKey");
    if (!String(this.fhConfig.companyShortname ?? "").trim()) missing.push("companyShortname");

    if (missing.length > 0) {
      const list = missing.join(", ").replace(/, ([^,]*)$/, ", and $1");
      throw new Error(`FAREHARBOR PMS adapter requires ${list} before live calls.`);
    }
  }

  private fareHarborHeaders(): Record<string, string> {
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-FareHarbor-API-App": String(this.fhConfig.appKey),
      "X-FareHarbor-API-User": String(this.fhConfig.userKey)
    };
  }

  private companyPath(suffix: string): string {
    const base = String(this.fhConfig.baseUrl).replace(/\/$/, "");
    const shortname = String(this.fhConfig.companyShortname);
    const tail = suffix.startsWith("/") ? suffix : `/${suffix}`;
    return `${base}/companies/${shortname}${tail}`;
  }

  private async fareHarborRequest(method: "GET" | "POST", url: string, body?: unknown): Promise<UnknownRecord> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.fhConfig.timeoutMs ?? 5000);

    try {
      const response = await this.fetcher(url, {
        method,
        headers: this.fareHarborHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: abortController.signal
      });

      if (!response.ok) {
        const detail = (await response.text()).trim().slice(0, 500);
        throw new Error(
          `FAREHARBOR PMS API request failed with status ${response.status}${detail ? `: ${detail}` : "."}`
        );
      }

      return this.asRecord(await response.json());
    } finally {
      clearTimeout(timeout);
    }
  }

  private readArray(record: UnknownRecord, key: string): UnknownRecord[] {
    const value = record[key];
    return Array.isArray(value) ? value.map((item) => this.asRecord(item)) : [];
  }

  private asRecordOrEmpty(value: unknown): UnknownRecord {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as UnknownRecord;
  }

  private rateLabel(rate: UnknownRecord): string {
    const prototype = this.asRecordOrEmpty(rate["customer_prototype"]);
    return (
      this.readOptionalString(prototype, ["display_name", "name", "note"]) ??
      this.readOptionalString(rate, ["display_name", "note"]) ??
      ""
    );
  }

  private ratePriceCents(rate: UnknownRecord): number {
    // FareHarbor "total" / "total_including_tax" are already in the smallest currency unit.
    return this.readNumber(rate, ["total_including_tax", "total", "amount"]);
  }

  private async fetchAvailabilities(productId: string, dateText: string) {
    const date = resolveFareHarborDate(dateText);
    const url = this.companyPath(`/items/${encodeURIComponent(productId)}/availability/date/${date}/`);
    const payload = await this.fareHarborRequest("GET", url);
    return { date, availabilities: this.readArray(payload, "availabilities") };
  }

  private remainingOf(availability: UnknownRecord): number {
    return this.readNumber(availability, ["capacity", "remaining", "spots_remaining"]);
  }

  async listProducts(): Promise<PmsProduct[]> {
    this.assertFareHarborConfigured();
    const payload = await this.fareHarborRequest("GET", this.companyPath("/items/"));

    return this.readArray(payload, "items").map((item) => ({
      externalProductId: this.readString(item, ["pk", "id", "externalProductId"]),
      title: this.readString(item, ["name", "title"]),
      description: this.readOptionalString(item, ["description", "headline", "summary"]) ?? "",
      bookingMode: "AUTO_BOOKING" as const
    }));
  }

  async getAvailability(request: PmsAvailabilityRequest): Promise<PmsAvailabilityResult> {
    this.assertFareHarborConfigured();

    const { date, availabilities } = await this.fetchAvailabilities(request.productId, request.date);

    if (availabilities.length === 0) {
      return {
        productId: request.productId,
        date,
        available: false,
        remaining: 0,
        currency: "AUD",
        unitPriceCents: 0
      };
    }

    const bookable = availabilities.filter((availability) => this.remainingOf(availability) >= request.guests);
    const chosen = bookable[0] ?? availabilities[0];
    const remaining = this.remainingOf(chosen);
    const rates = this.readArray(chosen, "customer_type_rates");

    const ticketOptions: PmsTicketOption[] = rates
      .map((rate) => ({ label: this.rateLabel(rate), unitPriceCents: this.ratePriceCents(rate) }))
      .filter((ticket) => ticket.label);

    const headlineRate = rates
      .map((rate, index) => ({ rate, index, score: scoreCustomerTypeName(this.rateLabel(rate)) }))
      .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.rate;
    const unitPriceCents = headlineRate ? this.ratePriceCents(headlineRate) : 0;

    const timeOptions: PmsTimeOption[] = bookable
      .map((availability) => {
        const startTimeLocal = this.readOptionalString(availability, ["start_at", "startAt", "start"]);
        if (!startTimeLocal) return null;
        const checkoutSessionId = this.readOptionalString(availability, ["pk", "uuid", "id"]);
        return {
          label: startTimeLocal,
          startTimeLocal,
          remaining: this.remainingOf(availability),
          ...(checkoutSessionId ? { checkoutSessionId } : {})
        };
      })
      .filter((option): option is PmsTimeOption => Boolean(option));

    return {
      productId: request.productId,
      date,
      available: remaining >= request.guests,
      remaining,
      currency: this.readOptionalString(chosen, ["currency", "currency_code"]) ?? "AUD",
      unitPriceCents,
      ...(timeOptions.length > 0 ? { timeOptions } : {}),
      ...(ticketOptions.length > 0 ? { ticketOptions } : {})
    };
  }

  async createBooking(request: PmsCreateBookingRequest): Promise<PmsCreateBookingResult> {
    this.assertFareHarborConfigured();

    // Re-resolve the availability from productId + date (mirrors the Rezdy adapter - the booking
    // request carries no availability pk). FareHarbor books against a specific availability pk.
    const { availabilities } = await this.fetchAvailabilities(request.productId, request.date);
    const chosen =
      availabilities.find((availability) => this.remainingOf(availability) >= request.guests) ?? availabilities[0];

    if (!chosen || this.remainingOf(chosen) < request.guests) {
      return { externalBookingId: "", provider: "FAREHARBOR", status: "FAILED" };
    }

    const availabilityPk = this.readOptionalString(chosen, ["pk", "uuid", "id"]);
    const rates = this.readArray(chosen, "customer_type_rates");
    const customers = this.buildCustomers(request, rates);

    // Never invent a booking we cannot map faithfully (no slot pk, or no resolvable rate).
    if (!availabilityPk || customers.length === 0) {
      return { externalBookingId: "", provider: "FAREHARBOR", status: "FAILED" };
    }

    const url = this.companyPath(`/availabilities/${encodeURIComponent(availabilityPk)}/bookings/`);
    const payload = await this.fareHarborRequest("POST", url, {
      contact: {
        name: request.travellerName,
        email: request.travellerEmail,
        ...(request.travellerPhone ? { phone: request.travellerPhone } : {})
      },
      customers,
      ...(request.paymentCardToken ? { payment_type: "card", cc_token: request.paymentCardToken } : {})
    });

    const booking = this.asRecordOrEmpty(payload["booking"]);
    const externalBookingId =
      this.readOptionalString(booking, ["pk", "uuid", "display_id"]) ??
      this.readOptionalString(payload, ["pk", "uuid"]) ??
      "";
    const rawStatus = (this.readOptionalString(booking, ["status"]) ?? "").toLowerCase();
    const status: PmsCreateBookingResult["status"] = !externalBookingId
      ? "FAILED"
      : rawStatus === "cancelled" || rawStatus === "failed"
        ? "FAILED"
        : request.confirmationMode === "PAYMENT_HOLD" || rawStatus === "pending"
          ? "PENDING"
          : "CONFIRMED";

    return {
      externalBookingId,
      provider: "FAREHARBOR",
      status,
      paymentUrl: this.readOptionalString(booking, ["payment_url", "checkout_url"]) ?? null
    };
  }

  /**
   * Map guests / ticket quantities to FareHarbor customers[] (each is a customer_type_rate pk).
   * Ticket optionLabels are matched to the availability's rate labels; unmatched labels are
   * skipped rather than guessed. With no ticket split, every guest takes the headline rate.
   */
  private buildCustomers(
    request: PmsCreateBookingRequest,
    rates: UnknownRecord[]
  ): Array<{ customer_type_rate: string }> {
    const pkByLabel = new Map<string, string>();
    for (const rate of rates) {
      const pk = this.readOptionalString(rate, ["pk", "uuid", "id"]);
      const label = this.rateLabel(rate).toLowerCase();
      if (pk && label) pkByLabel.set(label, pk);
    }

    if (request.ticketQuantities && request.ticketQuantities.length > 0) {
      return request.ticketQuantities.flatMap((ticket) => {
        const pk = pkByLabel.get(ticket.optionLabel.toLowerCase());
        if (!pk) return [];
        return Array.from({ length: Math.max(0, ticket.quantity) }, () => ({ customer_type_rate: pk }));
      });
    }

    const headlineRate = rates
      .map((rate, index) => ({ rate, index, score: scoreCustomerTypeName(this.rateLabel(rate)) }))
      .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.rate;
    const headlinePk = headlineRate ? this.readOptionalString(headlineRate, ["pk", "uuid", "id"]) : null;
    if (!headlinePk) return [];

    return Array.from({ length: Math.max(1, request.guests) }, () => ({ customer_type_rate: headlinePk }));
  }
}
