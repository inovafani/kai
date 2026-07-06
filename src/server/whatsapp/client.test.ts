import { describe, expect, it } from "vitest";
import { buildWhatsAppTemplatePayload } from "./client";

describe("WhatsApp client", () => {
  it("normalizes Indonesian local recipient numbers to international digits", () => {
    const payload = buildWhatsAppTemplatePayload({
      to: "085337210180",
      name: "booking_inquiry_operator"
    });

    expect(payload.to).toBe("6285337210180");
  });
});
