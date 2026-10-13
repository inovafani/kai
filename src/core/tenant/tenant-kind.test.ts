import { describe, expect, it } from "vitest";
import { startsOperatorRecommendation } from "./tenant-kind";

describe("startsOperatorRecommendation", () => {
  it("is true for BluePass's own chat, with no flag needed", () => {
    expect(startsOperatorRecommendation({ kind: "PLATFORM", config: { enabledFeatures: [] } })).toBe(true);
    expect(startsOperatorRecommendation({ kind: "PLATFORM", config: null })).toBe(true);
  });

  it("keeps working for an operator that fronts the shared recommendation through the old flag", () => {
    expect(startsOperatorRecommendation({ kind: "OPERATOR", config: { enabledFeatures: ["whatsapp_generic_eligible"] } })).toBe(true);
  });

  it("is false for an ordinary operator", () => {
    expect(startsOperatorRecommendation({ kind: "OPERATOR", config: { enabledFeatures: ["widget_config"] } })).toBe(false);
    expect(startsOperatorRecommendation({ config: null })).toBe(false);
  });
});
