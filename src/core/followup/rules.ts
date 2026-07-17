import { buildFollowUpMessage } from "./messages";
import {
  STAGE_TO_AUDIENCE,
  STAGE_TO_KIND,
  type FollowUpCandidate,
  type FollowUpConfig,
  type FollowUpDecision,
  type FollowUpPlan,
} from "./types";

/**
 * Approved WhatsApp template names, kept as literals here so core stays
 * free of any server import. Source of truth: src/server/whatsapp/templates.ts
 * (whatsappTemplateNames). If those change, update both.
 */
const TEMPLATE_TRAVELLER_UPDATE = "bluepass_inquiry_update";
const TEMPLATE_OPERATOR_INQUIRY = "booking_inquiry_operator";

function hoursBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / 3_600_000;
}

/** Local wall-clock hour in a tz, resilient to a bad tz string. */
export function localHour(now: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).formatToParts(now);
    const value = parts.find((part) => part.type === "hour")?.value ?? "0";
    const hour = Number(value);
    return Number.isFinite(hour) ? hour % 24 : now.getUTCHours();
  } catch {
    return now.getUTCHours();
  }
}

/** Quiet window may wrap midnight (start 21, end 8 → 21:00–07:59 local). */
export function isInQuietHours(hour: number, quiet: { startHour: number; endHour: number }): boolean {
  const { startHour, endHour } = quiet;
  // Degenerate / out-of-range windows fail OPEN (treated as "no quiet
  // window"), so a misconfigured tenant can never permanently stall its
  // follow-ups. Hours must be integers in 0..23; use validateFollowUpConfig
  // to catch bad config at startup.
  const inRange = (h: number) => Number.isInteger(h) && h >= 0 && h <= 23;
  if (startHour === endHour || !inRange(startHour) || !inRange(endHour)) return false;
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}

function hasDeliverableChannel(candidate: FollowUpCandidate): boolean {
  switch (candidate.channel) {
    case "whatsapp":
    case "sms":
      return candidate.contact.hasPhone;
    case "email":
      return candidate.contact.hasEmail;
    case "web":
      return true;
  }
}

/**
 * Decide whether one candidate is due for a follow-up right now. Returns a
 * reasoned suppression when not, so every branch is observable and testable.
 *
 * Check order is deliberate: never-nudge conditions first (terminal,
 * unreachable, already-answered), then timing / cadence / cooldown, and
 * quiet-hours last — so an otherwise-due nudge is simply deferred to the
 * next run outside quiet hours rather than dropped.
 */
export function evaluateFollowUp(
  candidate: FollowUpCandidate,
  now: Date,
  config: FollowUpConfig,
): FollowUpDecision {
  if (candidate.isTerminal) return { due: false, reason: "terminal" };
  if (!hasDeliverableChannel(candidate)) return { due: false, reason: "no_contact_channel" };

  const audience = STAGE_TO_AUDIENCE[candidate.stage];
  const rule = config.thresholds[candidate.stage];

  // The party we'd message already acted after the stage began → trigger is
  // stale, suppress. Operator stage watches the operator clock; everything
  // else watches the customer clock.
  const partyLastActedAt =
    audience === "operator" ? candidate.lastOperatorActivityAt : candidate.lastTravellerActivityAt;
  if (partyLastActedAt && partyLastActedAt.getTime() > candidate.stageEnteredAt.getTime()) {
    return { due: false, reason: "party_already_responded" };
  }

  if (hoursBetween(now, candidate.stageEnteredAt) < rule.firstAfterHours) {
    return { due: false, reason: "not_due_yet" };
  }
  if (candidate.followUpCount >= rule.maxFollowUps) {
    return { due: false, reason: "cadence_exhausted" };
  }
  if (candidate.lastFollowUpAt && hoursBetween(now, candidate.lastFollowUpAt) < rule.minGapHours) {
    return { due: false, reason: "cooldown" };
  }

  // Empty/whitespace tz must fall back to the config default, not to UTC —
  // `??` would let "" through, so use a falsy-aware fallback.
  const timezone = candidate.timezone?.trim() || config.defaultTimezone;
  if (isInQuietHours(localHour(now, timezone), config.quietHours)) {
    return { due: false, reason: "quiet_hours" };
  }

  const kind = STAGE_TO_KIND[candidate.stage];
  const isWhatsApp = candidate.channel === "whatsapp";
  // Outside the 24h window we MUST use a template. Treat unknown (null) and
  // future-dated / clock-skewed inbound times (negative age) as outside the
  // window too — the safe default is to require a template, never to send
  // free-form when we can't prove the window is open.
  const inboundAgeHours = candidate.lastInboundAt ? hoursBetween(now, candidate.lastInboundAt) : null;
  const outsideWindow =
    inboundAgeHours === null || inboundAgeHours < 0 || inboundAgeHours >= config.serviceWindowHours;
  const requiresTemplate = isWhatsApp && outsideWindow;

  const plan: FollowUpPlan = {
    candidateId: candidate.id,
    tenantId: candidate.tenantId,
    kind,
    audience,
    channel: candidate.channel,
    requiresTemplate,
    templateName: requiresTemplate
      ? audience === "operator"
        ? TEMPLATE_OPERATOR_INQUIRY
        : TEMPLATE_TRAVELLER_UPDATE
      : null,
    message: buildFollowUpMessage(kind, candidate),
    // Includes followUpCount so each successive allowed nudge is distinct,
    // and identical across re-runs before the send is recorded (idempotent).
    dedupeKey: `${candidate.id}:${kind}:${candidate.followUpCount}`,
  };

  return { due: true, plan };
}

/** Evaluate a batch; returns only the plans that should be sent this run. */
export function evaluateFollowUps(
  candidates: FollowUpCandidate[],
  now: Date,
  config: FollowUpConfig,
): FollowUpPlan[] {
  const plans: FollowUpPlan[] = [];
  for (const candidate of candidates) {
    const decision = evaluateFollowUp(candidate, now, config);
    if (decision.due) plans.push(decision.plan);
  }
  return plans;
}
