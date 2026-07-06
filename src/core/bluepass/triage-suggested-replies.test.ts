import { describe, expect, it } from "vitest";
import { bluePassTriageSuggestedReplies, classifyBluePassPersona } from "./triage";

describe("bluePassTriageSuggestedReplies", () => {
  it("offers exactly three chips within Meta's 20-char button limit", () => {
    expect(bluePassTriageSuggestedReplies).toHaveLength(3);
    for (const chip of bluePassTriageSuggestedReplies) {
      expect(chip.title.length).toBeLessThanOrEqual(20);
      expect(chip.title.trim().length).toBeGreaterThan(0);
    }
  });

  it("each chip title re-classifies to the persona its id names", () => {
    const expected: Record<string, "TRAVELLER" | "OPERATOR" | "PARTNER"> = {
      "triage:traveller": "TRAVELLER",
      "triage:operator": "OPERATOR",
      "triage:partner": "PARTNER"
    };

    for (const chip of bluePassTriageSuggestedReplies) {
      // A tapped chip re-enters the flow as its title text, so the classifier
      // must land it on the intended persona with no extra routing.
      expect(classifyBluePassPersona([chip.title])).toBe(expected[chip.id]);
    }
  });
});
