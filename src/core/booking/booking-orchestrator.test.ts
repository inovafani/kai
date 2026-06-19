import { describe, expect, it } from "vitest";
import { MockPmsAdapter } from "@/core/pms/mock-pms-adapter";
import { handleTravellerBookingMessage } from "./booking-orchestrator";

describe("booking orchestrator", () => {
  it("checks PMS availability when product, date, and guests are known", async () => {
    const result = await handleTravellerBookingMessage({
      message: "Can you check Komodo Day Trip for 3 guests tomorrow?",
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "AVAILABILITY_CHECKED",
      reply:
        "Komodo Day Trip is available for 3 guests on tomorrow. PMS shows 7 spots remaining at USD 185.00 per guest. I have not confirmed a booking yet.",
      replySource: "DETERMINISTIC"
    });
  });

  it("can use a safe LLM rewrite without changing the PMS action", async () => {
    const result = await handleTravellerBookingMessage({
      message: "Can you check Komodo Day Trip for 3 guests tomorrow?",
      pmsAdapter: new MockPmsAdapter(),
      llmClient: {
        async composeReply() {
          return "Komodo Day Trip is available for 3 guests tomorrow. PMS shows 7 spots remaining at USD 185.00 per guest. I have not confirmed a booking yet.";
        }
      }
    });

    expect(result).toEqual({
      action: "AVAILABILITY_CHECKED",
      reply:
        "Komodo Day Trip is available for 3 guests tomorrow. PMS shows 7 spots remaining at USD 185.00 per guest. I have not confirmed a booking yet.",
      replySource: "LLM"
    });
  });

  it("does not claim availability for manual inquiry products", async () => {
    const result = await handleTravellerBookingMessage({
      message: "Can you check Private Charter for 2 guests tomorrow?",
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "MANUAL_INQUIRY_REQUIRED",
      reply:
        "Private Charter requires operator confirmation. I can collect the details, but I will not confirm availability automatically.",
      replySource: "DETERMINISTIC"
    });
  });

  it("asks the traveller to choose a PMS product when product matching is unclear", async () => {
    const result = await handleTravellerBookingMessage({
      message: "Can you check a tour for 2 guests tomorrow?",
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "NEEDS_PRODUCT_SELECTION",
      reply:
        "Which tour should I check? Available options are Komodo Day Trip, Private Charter and Reef Day Snorkel.",
      replySource: "DETERMINISTIC"
    });
  });
  it("uses product matcher aliases before deciding PMS action", async () => {
    const result = await handleTravellerBookingMessage({
      message: "private boat for 2 guests tomorrow",
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "MANUAL_INQUIRY_REQUIRED",
      reply:
        "Private Charter requires operator confirmation. I can collect the details, but I will not confirm availability automatically.",
      replySource: "DETERMINISTIC"
    });
  });

  it("uses prior traveller messages as slot memory", async () => {
    const result = await handleTravellerBookingMessage({
      message: "tomorrow for 2 people",
      priorTravellerMessages: ["private boat"],
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "MANUAL_INQUIRY_REQUIRED",
      reply:
        "Private Charter requires operator confirmation. I can collect the details, but I will not confirm availability automatically.",
      replySource: "DETERMINISTIC"
    });
  });

});
