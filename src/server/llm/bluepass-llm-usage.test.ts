import { describe, expect, it, vi } from "vitest";
import { estimateBluePassLlmCostUsd, logBluePassLlmUsage } from "./bluepass-llm-usage";

describe("estimateBluePassLlmCostUsd", () => {
  it("computes a cost estimate for a known Groq model", () => {
    const cost = estimateBluePassLlmCostUsd("groq", "llama-3.3-70b-versatile", {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      totalTokens: 2_000_000
    });

    expect(cost).toBeCloseTo(0.59 + 0.79, 5);
  });

  it("computes a cost estimate for a known OpenAI model", () => {
    const cost = estimateBluePassLlmCostUsd("openai", "gpt-4.1-mini", {
      promptTokens: 500_000,
      completionTokens: 0,
      totalTokens: 500_000
    });

    expect(cost).toBeCloseTo(0.2, 5);
  });

  it("returns null for an unrecognized model instead of guessing", () => {
    expect(
      estimateBluePassLlmCostUsd("groq", "some-future-model", {
        promptTokens: 100,
        completionTokens: 100,
        totalTokens: 200
      })
    ).toBeNull();
  });
});

describe("logBluePassLlmUsage", () => {
  it("logs a structured bluepass_llm.usage entry with the cost estimate attached", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logBluePassLlmUsage({
      callType: "polish",
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      tenantName: "BluePass",
      usage: { promptTokens: 1000, completionTokens: 200, totalTokens: 1200 }
    });

    expect(logSpy).toHaveBeenCalledWith(
      "bluepass_llm.usage",
      expect.objectContaining({
        callType: "polish",
        provider: "groq",
        model: "llama-3.3-70b-versatile",
        tenantName: "BluePass",
        promptTokens: 1000,
        completionTokens: 200,
        totalTokens: 1200,
        estimatedCostUsd: expect.any(Number)
      })
    );

    logSpy.mockRestore();
  });

  it("defaults tenantName to null when not provided", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logBluePassLlmUsage({
      callType: "router",
      provider: "openai",
      model: "gpt-4.1-mini",
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 }
    });

    expect(logSpy).toHaveBeenCalledWith("bluepass_llm.usage", expect.objectContaining({ tenantName: null }));

    logSpy.mockRestore();
  });
});
