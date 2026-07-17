import { describe, expect, it } from "vitest";
import { extractBluePassLead, leadHasReachableChannel, mergeBluePassLead } from "./lead";
import { buildBluePassLeadCapturedReply } from "./triage";

describe("extractBluePassLead", () => {
  it("pulls email, phone, company, and region from one message", () => {
    const lead = extractBluePassLead([
      "We're Coral Cove Divers, based in Sorong. Email is ops@coralcove.com and whatsapp is +62 812 3456 7890"
    ]);

    expect(lead.email).toBe("ops@coralcove.com");
    expect(lead.phone).toContain("+62");
    expect(lead.company).toBe("Coral Cove Divers");
    expect(lead.region).toBe("Sorong");
  });

  it("accumulates details dripped across turns", () => {
    const first = extractBluePassLead(["I run a dive resort in Raja Ampat"]);
    const second = extractBluePassLead(["The company is Blue Horizon and my email is tim@bluehorizon.co"]);
    const merged = mergeBluePassLead(first, second);

    expect(merged.region).toBe("Raja Ampat");
    expect(merged.company).toBe("Blue Horizon");
    expect(merged.email).toBe("tim@bluehorizon.co");
  });

  it("extracts Australian regions (specific place + country fallback)", () => {
    expect(extractBluePassLead(["we run trips on the Great Barrier Reef"]).region).toBe("Great Barrier Reef");
    expect(extractBluePassLead(["charters in the Whitsundays"]).region).toBe("Whitsundays");
    expect(extractBluePassLead(["Ningaloo whale sharks"]).region).toBe("Ningaloo");
    // bare country only -> country fallback
    expect(extractBluePassLead(["we operate in Australia"]).region).toBe("Australia");
    // a specific AU place wins over the bare country
    expect(extractBluePassLead(["based in Cairns, Australia"]).region).toBe("Cairns");
  });

  it("does not mistake a region for a company name", () => {
    const lead = extractBluePassLead(["We're in Indonesia"]);

    expect(lead.company).toBeUndefined();
  });

  it("requires email or phone to count as reachable", () => {
    expect(leadHasReachableChannel({ company: "Blue Horizon" })).toBe(false);
    expect(leadHasReachableChannel({ email: "tim@bluehorizon.co" })).toBe(true);
    expect(leadHasReachableChannel({ phone: "+62 812 000" })).toBe(true);
  });
});

describe("buildBluePassLeadCapturedReply", () => {
  it("echoes captured details back so mistakes surface", () => {
    const reply = buildBluePassLeadCapturedReply({
      persona: "OPERATOR",
      lead: { company: "Coral Cove Divers", region: "Sorong", email: "ops@coralcove.com" }
    });

    expect(reply).toContain("Coral Cove Divers");
    expect(reply).toContain("ops@coralcove.com");
    expect(reply).toContain("claim link");
    expect(reply).toContain("usually same day");
  });

  it("gives partners the founding-terms next step", () => {
    const reply = buildBluePassLeadCapturedReply({
      persona: "PARTNER",
      lead: { email: "shop@divers.com.au" }
    });

    expect(reply).toContain("shop@divers.com.au");
    expect(reply).toContain("tracked link");
    expect(reply).toContain("Founding");
  });
});
