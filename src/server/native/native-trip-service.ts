import { Prisma } from "@prisma/client";
import { lowestTicketCents, nativeTripInputSchema, publishProblems, type NativeTripInput } from "@/core/native/native-trip-input";
import { prisma } from "@/lib/prisma";

/**
 * Trips, tickets, schedules and blackouts for one native operator, and the bookings that came in.
 * Everything is scoped to a tenant slug, and refuses a tenant that is not on the native booking
 * system, so an operator-facing screen can never write into a Rezdy or FareHarbor tenant.
 */

export class NativeTripError extends Error {
  constructor(
    readonly code: "TENANT_NOT_FOUND" | "NOT_NATIVE" | "TRIP_NOT_FOUND" | "INVALID_TRIP" | "CANNOT_PUBLISH" | "HAS_BOOKINGS",
    message: string,
    readonly status: number,
    readonly issues: string[] = []
  ) {
    super(message);
  }
}

async function requireNativeTenant(tenantSlug: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, slug: true, widgetPublicKey: true, config: { select: { pmsProvider: true } } }
  });
  if (!tenant) throw new NativeTripError("TENANT_NOT_FOUND", "That operator was not found.", 404);
  if (tenant.config?.pmsProvider !== "NATIVE") {
    throw new NativeTripError("NOT_NATIVE", "This operator is not on the BluePass booking system.", 409);
  }
  return tenant;
}

const tripInclude = {
  ticketTypes: { orderBy: [{ kind: "asc" as const }, { sortOrder: "asc" as const }, { label: "asc" as const }] },
  schedules: { orderBy: { localTime: "asc" as const } },
  blackouts: { orderBy: { fromDate: "asc" as const } }
} satisfies Prisma.NativeTripInclude;

type TripRow = Prisma.NativeTripGetPayload<{ include: typeof tripInclude }>;

export type NativeTripView = {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
  meetingPoint: string;
  photoUrls: string[];
  currency: string;
  timeZone: string;
  status: "DRAFT" | "PUBLISHED";
  tickets: { label: string; priceCents: number; kind: "TICKET" | "EXTRA"; sortOrder: number; active: boolean }[];
  schedules: { daysOfWeek: number[]; localTime: string; seats: number; validFrom: string | null; validUntil: string | null; active: boolean }[];
  blackouts: { fromDate: string; toDate: string; reason: string | null }[];
  lowestTicketCents: number | null;
  updatedAt: string;
};

function toView(trip: TripRow): NativeTripView {
  const tickets = trip.ticketTypes.map((ticket) => ({
    label: ticket.label,
    priceCents: ticket.priceCents,
    kind: ticket.kind,
    sortOrder: ticket.sortOrder,
    active: ticket.active
  }));
  return {
    id: trip.id,
    title: trip.title,
    description: trip.description,
    durationMinutes: trip.durationMinutes,
    meetingPoint: trip.meetingPoint,
    photoUrls: trip.photoUrls,
    currency: trip.currency,
    timeZone: trip.timeZone,
    status: trip.status,
    tickets,
    schedules: trip.schedules.map((schedule) => ({
      daysOfWeek: schedule.daysOfWeek,
      localTime: schedule.localTime,
      seats: schedule.seats,
      validFrom: schedule.validFrom,
      validUntil: schedule.validUntil,
      active: schedule.active
    })),
    blackouts: trip.blackouts.map((blackout) => ({ fromDate: blackout.fromDate, toDate: blackout.toDate, reason: blackout.reason })),
    lowestTicketCents: lowestTicketCents(tickets),
    updatedAt: trip.updatedAt.toISOString()
  };
}

function parseTrip(raw: unknown): NativeTripInput {
  const parsed = nativeTripInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message);
    throw new NativeTripError("INVALID_TRIP", issues[0] ?? "Check the trip details.", 400, issues);
  }
  return parsed.data;
}

function ticketRows(input: NativeTripInput) {
  return input.tickets.map((ticket, index) => ({
    label: ticket.label,
    priceCents: ticket.priceCents,
    kind: ticket.kind,
    sortOrder: ticket.sortOrder ?? index,
    active: ticket.active
  }));
}

export async function listNativeTrips(tenantSlug: string): Promise<NativeTripView[]> {
  const tenant = await requireNativeTenant(tenantSlug);
  const trips = await prisma.nativeTrip.findMany({ where: { tenantId: tenant.id }, include: tripInclude, orderBy: { createdAt: "asc" } });
  return trips.map(toView);
}

export async function getNativeTrip(tenantSlug: string, tripId: string): Promise<NativeTripView> {
  const tenant = await requireNativeTenant(tenantSlug);
  const trip = await prisma.nativeTrip.findFirst({ where: { id: tripId, tenantId: tenant.id }, include: tripInclude });
  if (!trip) throw new NativeTripError("TRIP_NOT_FOUND", "That trip was not found.", 404);
  return toView(trip);
}

/** Creates a draft. Travellers cannot see it until it is published. */
export async function createNativeTrip(tenantSlug: string, raw: unknown): Promise<NativeTripView> {
  const tenant = await requireNativeTenant(tenantSlug);
  const input = parseTrip(raw);

  const trip = await prisma.nativeTrip.create({
    data: {
      tenantId: tenant.id,
      title: input.title,
      description: input.description,
      durationMinutes: input.durationMinutes,
      meetingPoint: input.meetingPoint,
      photoUrls: input.photoUrls,
      currency: input.currency,
      timeZone: input.timeZone,
      status: "DRAFT",
      ticketTypes: { create: ticketRows(input) },
      schedules: { create: input.schedules },
      blackouts: { create: input.blackouts.map((blackout) => ({ tenantId: tenant.id, ...blackout, reason: blackout.reason ?? null })) }
    },
    include: tripInclude
  });
  return toView(trip);
}

/**
 * Replaces a trip's details, tickets, departure times and blocked dates with what was sent.
 * Departures that already exist keep the seat count they were created with, so editing a schedule
 * never shrinks a sailing that has paying travellers on it.
 */
export async function updateNativeTrip(tenantSlug: string, tripId: string, raw: unknown): Promise<NativeTripView> {
  const tenant = await requireNativeTenant(tenantSlug);
  const input = parseTrip(raw);

  const existing = await prisma.nativeTrip.findFirst({ where: { id: tripId, tenantId: tenant.id }, select: { id: true, status: true } });
  if (!existing) throw new NativeTripError("TRIP_NOT_FOUND", "That trip was not found.", 404);

  // A published trip is on sale: an edit may not leave it with nothing to buy or no time to run.
  if (existing.status === "PUBLISHED") {
    const problems = publishProblems(input);
    if (problems.length > 0) throw new NativeTripError("CANNOT_PUBLISH", problems[0], 400, problems);
  }

  const trip = await prisma.$transaction(async (tx) => {
    await tx.nativeTrip.update({
      where: { id: tripId },
      data: {
        title: input.title,
        description: input.description,
        durationMinutes: input.durationMinutes,
        meetingPoint: input.meetingPoint,
        photoUrls: input.photoUrls,
        currency: input.currency,
        timeZone: input.timeZone
      }
    });

    await tx.nativeTicketType.deleteMany({ where: { tripId } });
    await tx.nativeTicketType.createMany({ data: ticketRows(input).map((row) => ({ tripId, ...row })) });

    await tx.nativeSchedule.deleteMany({ where: { tripId } });
    await tx.nativeSchedule.createMany({ data: input.schedules.map((schedule) => ({ tripId, ...schedule })) });

    await tx.nativeBlackout.deleteMany({ where: { tripId } });
    await tx.nativeBlackout.createMany({
      data: input.blackouts.map((blackout) => ({ tenantId: tenant.id, tripId, ...blackout, reason: blackout.reason ?? null }))
    });

    return tx.nativeTrip.findUniqueOrThrow({ where: { id: tripId }, include: tripInclude });
  });

  return toView(trip);
}

export async function setNativeTripPublished(tenantSlug: string, tripId: string, published: boolean): Promise<NativeTripView> {
  const tenant = await requireNativeTenant(tenantSlug);
  const trip = await prisma.nativeTrip.findFirst({ where: { id: tripId, tenantId: tenant.id }, include: tripInclude });
  if (!trip) throw new NativeTripError("TRIP_NOT_FOUND", "That trip was not found.", 404);

  if (published) {
    const view = toView(trip);
    const problems = publishProblems(view);
    if (problems.length > 0) throw new NativeTripError("CANNOT_PUBLISH", problems[0], 400, problems);
  }

  const updated = await prisma.nativeTrip.update({ where: { id: tripId }, data: { status: published ? "PUBLISHED" : "DRAFT" }, include: tripInclude });
  return toView(updated);
}

/**
 * Deletes a trip nobody has booked. A trip with any booking, even a declined one, is a financial
 * record, so it is unpublished instead and kept.
 */
export async function deleteNativeTrip(tenantSlug: string, tripId: string): Promise<void> {
  const tenant = await requireNativeTenant(tenantSlug);
  const trip = await prisma.nativeTrip.findFirst({ where: { id: tripId, tenantId: tenant.id }, select: { id: true } });
  if (!trip) throw new NativeTripError("TRIP_NOT_FOUND", "That trip was not found.", 404);

  const bookings = await prisma.nativeBooking.count({ where: { departure: { tripId } } });
  if (bookings > 0) {
    throw new NativeTripError("HAS_BOOKINGS", "This trip has bookings, so it cannot be deleted. Unpublish it instead.", 409);
  }
  await prisma.nativeTrip.delete({ where: { id: tripId } });
}

export type NativeBookingView = {
  id: string;
  status: "HELD" | "WAITING_OPERATOR" | "CONFIRMED" | "DECLINED" | "CANCELLED" | "EXPIRED";
  tripId: string;
  tripTitle: string;
  localDate: string;
  localTime: string;
  seats: number;
  totalCents: number;
  currency: string;
  travellerName: string;
  travellerEmail: string;
  travellerPhone: string | null;
  tickets: { optionLabel: string; quantity: number }[];
  extras: { optionLabel: string; quantity: number }[];
  /** The payment attempt to accept or decline; null until the traveller has paid. */
  paymentAttemptId: string | null;
  operatorDeadlineAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
};

function readQuantities(value: Prisma.JsonValue | null): { optionLabel: string; quantity: number }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    return typeof record.optionLabel === "string" && typeof record.quantity === "number"
      ? [{ optionLabel: record.optionLabel, quantity: record.quantity }]
      : [];
  });
}

/**
 * The operator's bookings. Unpaid holds are left out: an abandoned checkout is noise, not a booking.
 * `pending` is just what is waiting for an answer.
 */
export async function listNativeBookings(tenantSlug: string, options: { scope?: "pending" | "all"; limit?: number } = {}): Promise<NativeBookingView[]> {
  const tenant = await requireNativeTenant(tenantSlug);
  const scope = options.scope ?? "all";
  const bookings = await prisma.nativeBooking.findMany({
    where: {
      tenantId: tenant.id,
      status: scope === "pending" ? "WAITING_OPERATOR" : { not: "HELD" }
    },
    include: { departure: { select: { tripId: true, localDate: true, localTime: true, trip: { select: { title: true } } } } },
    orderBy: scope === "pending" ? { operatorDeadlineAt: "asc" } : { createdAt: "desc" },
    take: Math.min(Math.max(options.limit ?? 100, 1), 200)
  });

  return bookings.map((booking) => ({
    id: booking.id,
    status: booking.status,
    tripId: booking.departure.tripId,
    tripTitle: booking.departure.trip.title,
    localDate: booking.departure.localDate,
    localTime: booking.departure.localTime,
    seats: booking.seats,
    totalCents: booking.totalCents,
    currency: booking.currency,
    travellerName: booking.travellerName,
    travellerEmail: booking.travellerEmail,
    travellerPhone: booking.travellerPhone,
    tickets: readQuantities(booking.ticketQuantities),
    extras: readQuantities(booking.extraQuantities),
    paymentAttemptId: booking.paymentAttemptId,
    operatorDeadlineAt: booking.operatorDeadlineAt?.toISOString() ?? null,
    decidedAt: booking.decidedAt?.toISOString() ?? null,
    decisionNote: booking.decisionNote,
    createdAt: booking.createdAt.toISOString()
  }));
}
