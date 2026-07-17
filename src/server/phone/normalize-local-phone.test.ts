import { describe, expect, it } from "vitest";
import { internationalToLocalPhone, normalizeLocalPhone } from "./normalize-local-phone";

describe("normalizeLocalPhone", () => {
  it("rewrites a leading 0 to the default Indonesia country code", () => {
    expect(normalizeLocalPhone("081234567890")).toBe("6281234567890");
  });

  it("strips non-digit formatting before normalizing", () => {
    expect(normalizeLocalPhone("0812-3456-7890")).toBe("6281234567890");
  });

  it("leaves an already-international number unchanged", () => {
    expect(normalizeLocalPhone("6281234567890")).toBe("6281234567890");
  });

  it("uses an explicit country code when provided", () => {
    expect(normalizeLocalPhone("0412345678", "61")).toBe("61412345678");
  });

  it("returns an empty string for empty input", () => {
    expect(normalizeLocalPhone("")).toBe("");
  });
});

describe("internationalToLocalPhone", () => {
  it("converts a matching country-code prefix back to a leading 0", () => {
    expect(internationalToLocalPhone("6281234567890")).toBe("081234567890");
  });

  it("returns null when the digits don't start with that country code", () => {
    expect(internationalToLocalPhone("61412345678")).toBeNull();
  });

  it("supports an explicit country code", () => {
    expect(internationalToLocalPhone("61412345678", "61")).toBe("0412345678");
  });
});
