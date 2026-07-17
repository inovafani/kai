import { describe, expect, it } from "vitest";
import { buildFollowUpMessage } from "./messages";
import type { FollowUpCandidate, FollowUpKind } from "./types";

function candidate(overrides: Partial<FollowUpCandidate> = {}): FollowUpCandidate {
  return {
    id: "inq_1",
    tenantId: "t_1",
    stage: "QUOTE_SENT",
    stageEnteredAt: new Date(),
    lastTravellerActivityAt: null,
    lastOperatorActivityAt: null,
    lastInboundAt: null,
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

const ALL_KINDS: FollowUpKind[] = [
  "QUOTE_AWAITING_TRAVELLER",
  "OPERATOR_UNRESPONSIVE",
  "DECLINED_NEEDS_ALTERNATIVE",
  "LEAD_UNCLAIMED",
  "TRIP_ABANDONED",
];

describe("buildFollowUpMessage", () => {
  it("includes the first name, trip, and quote link on a quote nudge", () => {
    const message = buildFollowUpMessage("QUOTE_AWAITING_TRAVELLER", candidate());
    expect(message).toContain("Ana");
    expect(message).not.toContain("Rivers"); // first name only
    expect(message).toContain("Aliikai");
    expect(message).toContain("https://bluepass.co/quotes/inq_1");
  });

  it("gives the operator the trip, date, and party size to act on", () => {
    const message = buildFollowUpMessage("OPERATOR_UNRESPONSIVE", candidate());
    expect(message).toContain("10 Nov");
    expect(message).toContain("2 guests");
    expect(message.toLowerCase()).toContain("accept");
  });

  it("degrades gracefully with no name, trip, or context — never prints null", () => {
    const bare = candidate({
      contact: { name: null, hasPhone: true, hasEmail: false },
      tripSummary: null,
      destination: null,
      operatorName: null,
      dateWindow: null,
      guests: null,
      quoteUrl: null,
    });
    for (const kind of ALL_KINDS) {
      const message = buildFollowUpMessage(kind, bare);
      expect(message.toLowerCase()).not.toContain("null");
      expect(message).toContain("there"); // fallback name
      expect(message.length).toBeGreaterThan(10);
    }
  });

  it("keeps every message within a WhatsApp-friendly length", () => {
    for (const kind of ALL_KINDS) {
      expect(buildFollowUpMessage(kind, candidate()).length).toBeLessThanOrEqual(320);
    }
  });

  it("singularises a one-guest party", () => {
    const message = buildFollowUpMessage("OPERATOR_UNRESPONSIVE", candidate({ guests: 1 }));
    expect(message).toContain("1 guest");
    expect(message).not.toContain("1 guests");
  });
});
