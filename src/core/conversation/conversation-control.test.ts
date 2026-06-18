import { describe, expect, it } from "vitest";
import { canKaiReply } from "./types";

describe("conversation control", () => {
  it("allows Kai replies only in AI mode", () => {
    expect(canKaiReply("AI")).toBe(true);
    expect(canKaiReply("HUMAN")).toBe(false);
    expect(canKaiReply("PAUSED")).toBe(false);
  });
});
