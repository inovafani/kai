import { describe, expect, it } from "vitest";
import { evaluateFollowUp, evaluateFollowUps, isInQuietHours, localHour } from "./rules";
import { DEFAULT_FOLLOWUP_CONFIG, validateFollowUpConfig, type FollowUpCandidate } from "./types";

// Asia/Makassar is UTC+8 with no DST, so wall-clock math is deterministic.
const NOW = new Date("2026-03-10T06:00:00Z"); // 14:00 Makassar (daytime), 25h after stage

function candidate(overrides: Partial<FollowUpCandidate> = {}): FollowUpCandidate {
  return {
    id: "inq_1",
    tenantId: "t_1",
    stage: "QUOTE_SENT",
    stageEnteredAt: new Date("2026-03-09T05:00:00Z"), // 25h before NOW
    lastTravellerActivityAt: new Date("2026-03-09T04:00:00Z"), // before the stage
    lastOperatorActivityAt: null,
    lastInboundAt: new Date("2026-03-09T05:00:00Z"), // 25h before NOW → outside 24h window
    lastFollowUpAt: null,
    followUpCount: 0,
    channel: "whatsapp",
    contact: { name: "Ana Rivers", hasPhone: true, hasEmail: true },
    tripSummary: "Aliikai, Raja Ampat",
    destination: "Raja Ampat",
    operatorName: "Aliikai",
    dateWindow: "10 Nov",
    guests: 2,
    quoteUrl: "https://bluepass.co/quotes/inq_1",
    isTerminal: false,
    timezone: "Asia/Makassar",
    ...overrides,
  };
}

describe("evaluateFollowUp — suppression reasons", () => {
  it("never nudges a terminal record", () => {
    expect(evaluateFollowUp(candidate({ isTerminal: true }), NOW, DEFAULT_FOLLOWUP_CONFIG)).toEqual({
      due: false,
      reason: "terminal",
    });
  });

  it("suppresses when the channel is unreachable", () => {
    const noPhone = candidate({ contact: { name: "Ana", hasPhone: false, hasEmail: true } });
    expect(evaluateFollowUp(noPhone, NOW, DEFAULT_FOLLOWUP_CONFIG)).toEqual({
      due: false,
      reason: "no_contact_channel",
    });
  });

  it("suppresses when the traveller already replied after the quote was sent", () => {
    const replied = candidate({ lastTravellerActivityAt: new Date("2026-03-09T10:00:00Z") });
    expect(evaluateFollowUp(replied, NOW, DEFAULT_FOLLOWUP_CONFIG).due).toBe(false);
    expect(evaluateFollowUp(replied, NOW, DEFAULT_FOLLOWUP_CONFIG)).toMatchObject({
      reason: "party_already_responded",
    });
  });

  it("watches the operator clock, not the traveller clock, for an operator chase", () => {
    const base = candidate({
      stage: "OPERATOR_PENDING",
      stageEnteredAt: new Date("2026-03-09T17:00:00Z"), // 13h before NOW (>12h SLA)
      lastTravellerActivityAt: new Date("2026-03-10T05:00:00Z"), // traveller pinged — irrelevant
      lastOperatorActivityAt: null,
    });
    expect(evaluateFollowUp(base, NOW, DEFAULT_FOLLOWUP_CONFIG).due).toBe(true);

    const operatorReplied = candidate({
      stage: "OPERATOR_PENDING",
      stageEnteredAt: new Date("2026-03-09T17:00:00Z"),
      lastOperatorActivityAt: new Date("2026-03-09T20:00:00Z"),
    });
    expect(evaluateFollowUp(operatorReplied, NOW, DEFAULT_FOLLOWUP_CONFIG)).toMatchObject({
      due: false,
      reason: "party_already_responded",
    });
  });

  it("suppresses before the first-nudge threshold", () => {
    const tooSoon = candidate({ stageEnteredAt: new Date("2026-03-10T00:00:00Z") }); // 6h < 24h
    expect(evaluateFollowUp(tooSoon, NOW, DEFAULT_FOLLOWUP_CONFIG)).toMatchObject({
      due: false,
      reason: "not_due_yet",
    });
  });

  it("stops once the cadence cap is reached", () => {
    const maxed = candidate({ followUpCount: 2 }); // QUOTE_SENT max is 2
    expect(evaluateFollowUp(maxed, NOW, DEFAULT_FOLLOWUP_CONFIG)).toMatchObject({
      due: false,
      reason: "cadence_exhausted",
    });
  });

  it("respects the cooldown between nudges", () => {
    const recent = candidate({
      followUpCount: 1,
      lastFollowUpAt: new Date("2026-03-09T18:00:00Z"), // 12h ago < 48h gap
    });
    expect(evaluateFollowUp(recent, NOW, DEFAULT_FOLLOWUP_CONFIG)).toMatchObject({
      due: false,
      reason: "cooldown",
    });
  });

  it("defers during local quiet hours", () => {
    const night = new Date("2026-03-10T15:00:00Z"); // 23:00 Makassar
    const late = candidate({ stageEnteredAt: new Date("2026-03-09T14:00:00Z") }); // 25h before night
    expect(evaluateFollowUp(late, night, DEFAULT_FOLLOWUP_CONFIG)).toMatchObject({
      due: false,
      reason: "quiet_hours",
    });
  });
});

describe("evaluateFollowUp — due plans", () => {
  it("produces a quote nudge with the right kind, audience, and dedupe key", () => {
    const decision = evaluateFollowUp(candidate(), NOW, DEFAULT_FOLLOWUP_CONFIG);
    expect(decision.due).toBe(true);
    if (!decision.due) return;
    expect(decision.plan.kind).toBe("QUOTE_AWAITING_TRAVELLER");
    expect(decision.plan.audience).toBe("traveller");
    expect(decision.plan.dedupeKey).toBe("inq_1:QUOTE_AWAITING_TRAVELLER:0");
    expect(decision.plan.message).toContain("Ana");
  });

  it("requires an approved template when WhatsApp is outside the 24h window", () => {
    const decision = evaluateFollowUp(candidate(), NOW, DEFAULT_FOLLOWUP_CONFIG);
    if (!decision.due) throw new Error("expected due");
    expect(decision.plan.requiresTemplate).toBe(true);
    expect(decision.plan.templateName).toBe("bluepass_inquiry_update");
  });

  it("allows a free-form message when WhatsApp is inside the 24h window", () => {
    const inWindow = candidate({ lastInboundAt: new Date("2026-03-10T04:00:00Z") }); // 2h ago
    const decision = evaluateFollowUp(inWindow, NOW, DEFAULT_FOLLOWUP_CONFIG);
    if (!decision.due) throw new Error("expected due");
    expect(decision.plan.requiresTemplate).toBe(false);
    expect(decision.plan.templateName).toBeNull();
  });

  it("uses the operator template for an out-of-window operator chase", () => {
    const decision = evaluateFollowUp(
      candidate({
        stage: "OPERATOR_PENDING",
        stageEnteredAt: new Date("2026-03-09T17:00:00Z"),
        lastInboundAt: null,
      }),
      NOW,
      DEFAULT_FOLLOWUP_CONFIG,
    );
    if (!decision.due) throw new Error("expected due");
    expect(decision.plan.audience).toBe("operator");
    expect(decision.plan.templateName).toBe("booking_inquiry_operator");
  });

  it("never requires a template on the web channel and needs no phone", () => {
    const web = candidate({ channel: "web", contact: { name: "Ana", hasPhone: false, hasEmail: false } });
    const decision = evaluateFollowUp(web, NOW, DEFAULT_FOLLOWUP_CONFIG);
    expect(decision.due).toBe(true);
    if (!decision.due) return;
    expect(decision.plan.requiresTemplate).toBe(false);
  });
});

describe("evaluateFollowUps batch", () => {
  it("returns only the due plans", () => {
    const plans = evaluateFollowUps(
      [candidate(), candidate({ id: "inq_2", isTerminal: true }), candidate({ id: "inq_3", followUpCount: 5 })],
      NOW,
      DEFAULT_FOLLOWUP_CONFIG,
    );
    expect(plans.map((p) => p.candidateId)).toEqual(["inq_1"]);
  });
});

describe("evaluateFollowUp — review-hardening (adversarial cases)", () => {
  it("requires a template when lastInboundAt is future-dated (clock skew), never free-form", () => {
    // A negative inbound age must not read as 'inside the window'.
    const skewed = candidate({ lastInboundAt: new Date("2026-03-20T00:00:00Z") }); // after NOW
    const decision = evaluateFollowUp(skewed, NOW, DEFAULT_FOLLOWUP_CONFIG);
    if (!decision.due) throw new Error("expected due");
    expect(decision.plan.requiresTemplate).toBe(true);
    expect(decision.plan.templateName).toBe("bluepass_inquiry_update");
  });

  it("falls back to the config timezone (not UTC) when tz is an empty string", () => {
    const night = new Date("2026-03-10T15:00:00Z"); // 23:00 Makassar (quiet), 15:00 UTC (not quiet)
    const emptyTz = candidate({ timezone: "", stageEnteredAt: new Date("2026-03-09T14:00:00Z") });
    // If it wrongly used UTC, this would be due; using the Makassar default it defers.
    expect(evaluateFollowUp(emptyTz, night, DEFAULT_FOLLOWUP_CONFIG)).toMatchObject({
      due: false,
      reason: "quiet_hours",
    });
  });

  it("keeps firing an abandoned trip whose creating message equals the stage time (why the check is strict '>')", () => {
    // A draft's stageEnteredAt can equal the traveller's own last message.
    // With '>=' this would suppress every abandoned trip forever; '>' is correct.
    const draft = candidate({
      stage: "INQUIRY_DRAFT",
      stageEnteredAt: new Date("2026-03-09T22:00:00Z"),
      lastTravellerActivityAt: new Date("2026-03-09T22:00:00Z"), // exactly equal
    });
    expect(evaluateFollowUp(draft, NOW, DEFAULT_FOLLOWUP_CONFIG).due).toBe(true);
  });
});

describe("validateFollowUpConfig", () => {
  it("passes the default config", () => {
    expect(validateFollowUpConfig(DEFAULT_FOLLOWUP_CONFIG)).toEqual([]);
  });

  it("flags an out-of-range quiet window that would otherwise stall follow-ups", () => {
    const bad = { ...DEFAULT_FOLLOWUP_CONFIG, quietHours: { startHour: 0, endHour: 24 } };
    expect(validateFollowUpConfig(bad).length).toBeGreaterThan(0);
  });
});

describe("quiet-hours + tz helpers", () => {
  it("wraps a midnight-spanning quiet window", () => {
    expect(isInQuietHours(23, { startHour: 21, endHour: 8 })).toBe(true);
    expect(isInQuietHours(3, { startHour: 21, endHour: 8 })).toBe(true);
    expect(isInQuietHours(14, { startHour: 21, endHour: 8 })).toBe(false);
    expect(isInQuietHours(8, { startHour: 21, endHour: 8 })).toBe(false);
  });

  it("fails open on a degenerate or out-of-range window (never permanently quiet)", () => {
    expect(isInQuietHours(3, { startHour: 8, endHour: 8 })).toBe(false); // empty window
    expect(isInQuietHours(3, { startHour: 0, endHour: 24 })).toBe(false); // 24 is out of range → fail open
  });

  it("reads the local hour for a timezone and falls back on a bad tz", () => {
    expect(localHour(new Date("2026-03-10T06:00:00Z"), "Asia/Makassar")).toBe(14); // UTC+8
    expect(localHour(new Date("2026-03-10T06:00:00Z"), "Not/AZone")).toBe(6); // falls back to UTC
  });
});
