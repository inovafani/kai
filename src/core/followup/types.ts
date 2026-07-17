/**
 * Follow-up engine — turns Kai from reactive to proactive.
 *
 * Kai only ever speaks when spoken to today. This module decides, from
 * timestamps that already exist on inquiries / quotes / leads, WHICH ones
 * are due for a nudge, WHAT nudge, and on WHICH channel — without ever
 * over-messaging a customer. It is pure core: no Prisma, no I/O, no clock
 * of its own (the caller passes `now`), so every branch is unit-testable.
 *
 * The live layer (a scheduled job) is a thin shell over this: query the DB
 * into FollowUpCandidate[], call evaluateFollowUps(candidates, now, config),
 * send the returned plans, and record each send back onto the candidate's
 * follow-up history so cadence holds next run. Those hooks are intentionally
 * left for the repo owner (they need the DB + WhatsApp send + a cron).
 */

export type FollowUpChannel = "whatsapp" | "sms" | "web" | "email";

/**
 * Where a candidate currently sits. Stages are mutually exclusive by
 * construction (a quote is only sent after the operator accepts, etc.), so
 * one candidate yields at most one follow-up kind.
 */
export type FollowUpStage =
  | "QUOTE_SENT" // quote drafted READY_FOR_TRAVELLER, not yet approved
  | "OPERATOR_PENDING" // dispatched to operator, awaiting their reply
  | "DECLINED" // operator declined, no alternative taken up
  | "LEAD_OPEN" // operator/partner lead captured, not claimed
  | "INQUIRY_DRAFT"; // partial trip intent, never submitted

/** The nudge kind, 1:1 with the stage it addresses. */
export type FollowUpKind =
  | "QUOTE_AWAITING_TRAVELLER"
  | "OPERATOR_UNRESPONSIVE"
  | "DECLINED_NEEDS_ALTERNATIVE"
  | "LEAD_UNCLAIMED"
  | "TRIP_ABANDONED";

/** Who the nudge is aimed at — decides which "already responded" clock matters. */
export type FollowUpAudience = "traveller" | "operator" | "lead";

/**
 * A normalized, storage-agnostic view of one nudge-able record. The live
 * layer builds these from BluePassInquiry + its events; the engine never
 * sees Prisma. All times are Date (UTC instants).
 */
export interface FollowUpCandidate {
  id: string; // inquiry or lead id — also the dedupe key root
  tenantId: string;
  stage: FollowUpStage;

  /** When it entered the current stage (quote sent, dispatched, declined…). */
  stageEnteredAt: Date;
  /** Last inbound message from the traveller, if any. */
  lastTravellerActivityAt: Date | null;
  /** Last inbound/action from the operator, if any. */
  lastOperatorActivityAt: Date | null;
  /**
   * Last inbound from the party we'd message, on the target channel — used
   * for the WhatsApp 24-hour service window. Null = never / unknown.
   */
  lastInboundAt: Date | null;

  /**
   * Prior follow-up history for cadence control. The live layer MUST record
   * each send (incrementing followUpCount / setting lastFollowUpAt) before
   * the next scheduler run, and MUST dedupe on the plan's `dedupeKey` — the
   * engine keeps the key stable across re-runs precisely so a delayed record
   * can't produce a duplicate send, but only the sender can enforce that.
   */
  lastFollowUpAt: Date | null;
  followUpCount: number;

  channel: FollowUpChannel;
  contact: {
    name: string | null;
    hasPhone: boolean;
    hasEmail: boolean;
  };

  /** Copy context. */
  tripSummary: string | null;
  destination: string | null;
  operatorName: string | null;
  dateWindow: string | null;
  guests: number | null;
  quoteUrl: string | null;

  /**
   * Caller-computed lifecycle truth — never nudge when true. The engine
   * trusts this: it cannot see bookings/payments. The live layer MUST set it
   * for a converted booking, an approved quote (BLUEPASS_QUOTE_APPROVED), an
   * operator-declined inquiry whose alternative was taken, or a CLOSED
   * record. The `party_already_responded` check is only a second line of
   * defence (it misses button-click approvals that leave no message).
   */
  isTerminal: boolean;
  /** IANA tz for quiet-hours; falls back to config.defaultTimezone when null. */
  timezone: string | null;
}

export interface FollowUpStageRule {
  /** Hours after the stage was entered before the first nudge is due. */
  firstAfterHours: number;
  /** Total nudges allowed for this stage before we stop. */
  maxFollowUps: number;
  /** Minimum hours between nudges for the same candidate. */
  minGapHours: number;
}

export interface FollowUpConfig {
  thresholds: Record<FollowUpStage, FollowUpStageRule>;
  /** Local quiet window [startHour, endHour); wraps midnight when start > end. */
  quietHours: { startHour: number; endHour: number };
  defaultTimezone: string;
  /** WhatsApp customer-service window; outside it, sends need an approved template. */
  serviceWindowHours: number;
}

export type FollowUpSuppressionReason =
  | "terminal"
  | "no_contact_channel"
  | "party_already_responded"
  | "not_due_yet"
  | "cooldown"
  | "cadence_exhausted"
  | "quiet_hours";

export interface FollowUpPlan {
  candidateId: string;
  tenantId: string;
  kind: FollowUpKind;
  audience: FollowUpAudience;
  channel: FollowUpChannel;
  /** True when the channel is WhatsApp and we're outside the 24h window. */
  requiresTemplate: boolean;
  /** Approved template to use when requiresTemplate is true; null otherwise. */
  templateName: string | null;
  /** Free-form message (used in-window / on web/email). */
  message: string;
  /** Stable idempotency key so the same nudge is never sent twice. */
  dedupeKey: string;
}

export type FollowUpDecision =
  | { due: false; reason: FollowUpSuppressionReason }
  | { due: true; plan: FollowUpPlan };

export const STAGE_TO_KIND: Record<FollowUpStage, FollowUpKind> = {
  QUOTE_SENT: "QUOTE_AWAITING_TRAVELLER",
  OPERATOR_PENDING: "OPERATOR_UNRESPONSIVE",
  DECLINED: "DECLINED_NEEDS_ALTERNATIVE",
  LEAD_OPEN: "LEAD_UNCLAIMED",
  INQUIRY_DRAFT: "TRIP_ABANDONED",
};

export const STAGE_TO_AUDIENCE: Record<FollowUpStage, FollowUpAudience> = {
  QUOTE_SENT: "traveller",
  OPERATOR_PENDING: "operator",
  DECLINED: "traveller",
  LEAD_OPEN: "lead",
  INQUIRY_DRAFT: "traveller",
};

/**
 * Launch defaults. Quote nudges lead (closest to money) and are allowed
 * twice; operator chases are urgent (short SLA); abandoned trips get a
 * single gentle re-engage. Tunable per tenant later.
 */
/**
 * Validate a config at startup. Returns a list of problems (empty = valid).
 * Guards against a degenerate quiet window that would permanently stall
 * follow-ups, and against non-positive thresholds. Quiet deferral relies on
 * the scheduled job re-running periodically (hourly recommended) — a nudge
 * deferred for quiet hours is retried next run, never recorded as sent.
 */
export function validateFollowUpConfig(config: FollowUpConfig): string[] {
  const problems: string[] = [];
  const { startHour, endHour } = config.quietHours;
  const inRange = (h: number) => Number.isInteger(h) && h >= 0 && h <= 23;
  if (!inRange(startHour) || !inRange(endHour)) {
    problems.push(`quietHours must be integer hours in 0..23 (got ${startHour}..${endHour})`);
  }
  if (config.serviceWindowHours <= 0) {
    problems.push(`serviceWindowHours must be positive (got ${config.serviceWindowHours})`);
  }
  for (const [stage, rule] of Object.entries(config.thresholds)) {
    if (rule.firstAfterHours < 0 || rule.maxFollowUps < 0 || rule.minGapHours < 0) {
      problems.push(`thresholds.${stage} has a negative value`);
    }
  }
  return problems;
}

export const DEFAULT_FOLLOWUP_CONFIG: FollowUpConfig = {
  thresholds: {
    QUOTE_SENT: { firstAfterHours: 24, maxFollowUps: 2, minGapHours: 48 },
    OPERATOR_PENDING: { firstAfterHours: 12, maxFollowUps: 2, minGapHours: 12 },
    DECLINED: { firstAfterHours: 3, maxFollowUps: 1, minGapHours: 24 },
    LEAD_OPEN: { firstAfterHours: 72, maxFollowUps: 2, minGapHours: 72 },
    INQUIRY_DRAFT: { firstAfterHours: 6, maxFollowUps: 1, minGapHours: 24 },
  },
  quietHours: { startHour: 21, endHour: 8 },
  defaultTimezone: "Asia/Makassar",
  serviceWindowHours: 24,
};
