import { describe, expect, it } from "vitest";
import { buildBluePassDispatchText } from "./dispatch";

describe("buildBluePassDispatchText", () => {
  it("builds an operator WhatsApp inquiry text without confirming booking", () => {
    const text = buildBluePassDispatchText({
      inquiryId: "inquiry_1",
      selectedYachtName: "Alila Purnama",
      travellerName: "Maya Chen",
      travellerPhone: "+61 400 111 222",
      destination: "Komodo",
      dateWindow: "next month",
      guests: 8,
      budget: "USD 10000",
      referralCode: "CREATOR42"
    });

    expect(text).toContain("BluePass inquiry inquiry_1");
    expect(text).toContain("Alila Purnama");
    expect(text).toContain("Maya Chen");
    expect(text).toContain("operator confirmation required");
    expect(text).not.toMatch(/confirmed booking/i);
  });
});
