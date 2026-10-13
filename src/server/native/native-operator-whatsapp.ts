import { prisma } from "@/lib/prisma";
import { decideNativeBooking, type NativeDecisionOutcome } from "@/server/payments/native-booking-decision";
import { sendWhatsAppText } from "@/server/whatsapp/client";

/**
 * An operator answering a paid native booking by WhatsApp, to the number the alert was sent to.
 *
 * Deliberately strict: only a message that is nothing but "accept" or "decline", optionally with the
 * booking reference, counts. An operator's free-text reply about a different matter is never read as
 * an answer to a booking, and a message that is not an answer to a native booking is left for the
 * rest of the WhatsApp handling untouched.
 */

export type NativeOperatorAnswer = { decision: "ACCEPT" | "DECLINE"; reference: string | null };

const ANSWER = /^\s*(accept|decline)(?:\s*[:\-]?\s*([a-z0-9_]{8,}))?\s*[.!]?\s*$/i;

export function parseNativeOperatorAnswer(body: string): NativeOperatorAnswer | null {
  const match = body.match(ANSWER);
  if (!match) return null;
  return { decision: match[1].toUpperCase() as "ACCEPT" | "DECLINE", reference: match[2] ?? null };
}

export type NativeOperatorWhatsAppResult = { handled: boolean };

type Dependencies = {
  decide: (input: { attemptId: string; decision: "ACCEPT" | "DECLINE"; tenantSlug: string }) => Promise<NativeDecisionOutcome>;
  reply: (to: string, body: string) => Promise<unknown>;
};

const REAL: Dependencies = {
  decide: (input) => decideNativeBooking(input),
  reply: (to, body) => sendWhatsAppText({ to, role: "ops", body })
};

function describe(outcome: NativeDecisionOutcome["outcome"], title: string) {
  switch (outcome) {
    case "CONFIRMED":
      return `Accepted: ${title}. The traveller is confirmed.`;
    case "REFUNDED":
      return `Declined: ${title}. The traveller has been refunded in full.`;
    case "REFUND_FAILED":
      return `Declined: ${title}, but the refund did not go through. BluePass has been alerted and will refund the traveller.`;
    default:
      return `${title} was already answered, so nothing changed.`;
  }
}

/**
 * Returns `{ handled: true }` when the message was an answer to a booking waiting on this phone's
 * operator (a reply was sent either way), and `{ handled: false }` for everything else.
 */
export async function handleNativeOperatorWhatsApp(
  message: { from: string; body: string },
  deps: Dependencies = REAL
): Promise<NativeOperatorWhatsAppResult> {
  const answer = parseNativeOperatorAnswer(message.body);
  if (!answer) return { handled: false };

  const phone = message.from.replace(/\D/g, "");
  if (!phone) return { handled: false };

  const waiting = await prisma.nativeBooking.findMany({
    where: {
      status: "WAITING_OPERATOR",
      paymentAttemptId: { not: null },
      tenant: { config: { is: { adminWhatsAppPhone: phone, pmsProvider: "NATIVE" } } }
    },
    include: {
      tenant: { select: { slug: true } },
      departure: { select: { localDate: true, localTime: true, trip: { select: { title: true } } } }
    },
    orderBy: { operatorDeadlineAt: "asc" }
  });

  const label = (booking: (typeof waiting)[number]) =>
    `${booking.departure.trip.title} on ${booking.departure.localDate} at ${booking.departure.localTime}, ${booking.travellerName}`;

  let target: (typeof waiting)[number] | undefined;

  if (answer.reference) {
    target = waiting.find((booking) => booking.id === answer.reference);
    if (!target) {
      // Not waiting on this phone. If it is still a booking of this operator's, say it is settled;
      // otherwise this was never about a native booking, so leave it to the other handlers.
      const known = await prisma.nativeBooking.findFirst({
        where: { id: answer.reference, tenant: { config: { is: { adminWhatsAppPhone: phone } } } },
        select: { id: true }
      });
      if (!known) return { handled: false };
      await deps.reply(message.from, "That booking was already answered, so nothing changed.");
      return { handled: true };
    }
  } else if (waiting.length === 1) {
    target = waiting[0];
  } else if (waiting.length > 1) {
    const lines = waiting.map((booking) => `${booking.id}: ${label(booking)}`).join("\n");
    await deps.reply(
      message.from,
      `You have ${waiting.length} bookings waiting. Reply ${answer.decision} followed by the reference of the one you mean:\n${lines}`
    );
    return { handled: true };
  } else {
    return { handled: false };
  }

  const outcome = await deps.decide({
    attemptId: target.paymentAttemptId as string,
    decision: answer.decision,
    tenantSlug: target.tenant.slug
  });
  await deps.reply(message.from, describe(outcome.outcome, label(target)));
  return { handled: true };
}
