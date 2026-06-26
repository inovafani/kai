import { describe, expect, it } from "vitest";
import { extractBluePassInquiryIntent, getMissingBluePassInquiryFields } from "./intent";

describe("BluePass inquiry intent", () => {
  it("extracts traveller and trip fields from message history", () => {
    const intent = extractBluePassInquiryIntent([
      "I want a Komodo yacht for 8 guests next month around USD 10000",
      "My name is Maya Chen, email maya@example.com, phone +61 400 111 222"
    ]);

    expect(intent).toMatchObject({
      destination: "Komodo",
      dateWindow: "next month",
      guests: 8,
      budget: "USD 10000",
      travellerName: "Maya Chen",
      travellerEmail: "maya@example.com",
      travellerPhone: "+61 400 111 222"
    });
  });

  it("reports required missing fields", () => {
    expect(
      getMissingBluePassInquiryFields({
        destination: "Komodo",
        guests: 8
      })
    ).toEqual(["dateWindow", "travellerName", "travellerEmail", "travellerPhone"]);
  });
});
