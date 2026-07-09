import { describe, expect, it } from "vitest";
import { buildBluePassResetConversationReply, isBluePassResetConversationRequest } from "./conversation-intent";
import { classifyBluePassPersona } from "./triage";

describe("BluePass decision layer", () => {
  it.each([
    ["I run a liveaboard in Komodo", "OPERATOR"],
    ["I book for clients and want referral commission", "PARTNER"],
    ["I want to book Calico Jack in Komodo", "TRAVELLER"],
    ["what is bluepass?", "UNKNOWN"],
    ["hello", "UNKNOWN"]
  ] as const)("classifies %s as %s", (message, expectedPersona) => {
    expect(classifyBluePassPersona({ messages: [message] })).toBe(expectedPersona);
  });

  it("keeps registered identity as source of truth for ambiguous business terms", () => {
    expect(
      classifyBluePassPersona({
        messages: ["what commission does BluePass take?"],
        identityPersona: "OPERATOR"
      })
    ).toBe("OPERATOR");

    expect(
      classifyBluePassPersona({
        messages: ["what commission does BluePass pay?"],
        identityPersona: "PARTNER"
      })
    ).toBe("PARTNER");
  });

  it("lets a registered operator or partner switch into traveller mode with a strong booking request", () => {
    expect(
      classifyBluePassPersona({
        messages: ["I want to book Calico Jack in Komodo on 19 July for 2 guests"],
        identityPersona: "OPERATOR"
      })
    ).toBe("TRAVELLER");

    expect(
      classifyBluePassPersona({
        messages: ["I want to reserve a Raja Ampat yacht on 12 August for 4 people"],
        identityPersona: "PARTNER"
      })
    ).toBe("TRAVELLER");
  });

  it("recognises reset requests and replies without old conversation state", () => {
    expect(isBluePassResetConversationRequest("New chat")).toBe(true);
    expect(isBluePassResetConversationRequest("ulang dari awal")).toBe(true);
    expect(isBluePassResetConversationRequest("new inquiry for Calico Jack")).toBe(false);
    expect(buildBluePassResetConversationReply()).toContain("Fresh chat started");
    expect(buildBluePassResetConversationReply()).toContain("compare BluePass liveaboards");
    expect(buildBluePassResetConversationReply({ persona: "OPERATOR", identityName: "Calico Jack" })).toContain(
      "Calico Jack"
    );
  });
});
