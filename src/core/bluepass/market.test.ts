import { describe, expect, it } from "vitest";
import {
  BLUEPASS_REGIONS,
  buildBluePassMarketGreeting,
  buildBluePassRegionPrompt,
  classifyBluePassMarket,
  classifyBluePassRegion,
  resolveBluePassGate
} from "./market";

describe("classifyBluePassMarket", () => {
  it("detects Australia from country + place names", () => {
    expect(classifyBluePassMarket(["we're an operator in Australia"])).toBe("AUSTRALIA");
    expect(classifyBluePassMarket(["day trips out of Port Douglas"])).toBe("AUSTRALIA");
    expect(classifyBluePassMarket(["charter on the Whitsundays"])).toBe("AUSTRALIA");
    expect(classifyBluePassMarket(["Ningaloo whale sharks"])).toBe("AUSTRALIA");
  });

  it("detects Indonesia from country + place names", () => {
    expect(classifyBluePassMarket(["I want to dive Komodo"])).toBe("INDONESIA");
    expect(classifyBluePassMarket(["liveaboard from Labuan Bajo"])).toBe("INDONESIA");
    expect(classifyBluePassMarket(["Raja Ampat in March"])).toBe("INDONESIA");
  });

  it("does not mislock the market on a personal name that looks like an AU city", () => {
    // "byron"/"cairns"/"perth"/"sydney" are common names - must not beat a real destination
    expect(classifyBluePassMarket(["Hi, I'm Byron, I want to dive Komodo"])).toBe("INDONESIA");
    expect(classifyBluePassMarket(["I'm Sarah Cairns, planning Raja Ampat"])).toBe("INDONESIA");
    expect(classifyBluePassMarket(["Perth here, thinking about Bali"])).toBe("INDONESIA");
    // genuine AU destinations still lock Australia
    expect(classifyBluePassMarket(["we run trips on the Great Barrier Reef"])).toBe("AUSTRALIA");
    expect(classifyBluePassMarket(["charters out of Byron Bay"])).toBe("AUSTRALIA");
  });

  it("returns UNKNOWN with no market signal, and locks the first signal", () => {
    expect(classifyBluePassMarket(["hi", "tell me more"])).toBe("UNKNOWN");
    // first message with a signal wins across the conversation
    expect(classifyBluePassMarket(["we're in Australia", "actually Komodo looks nice too"])).toBe("AUSTRALIA");
    // within one message, the earliest-appearing keyword wins
    expect(classifyBluePassMarket(["in Australia, might add Komodo later"])).toBe("AUSTRALIA");
  });

  it("M4: an explicit destination country outranks an earlier residence/place token", () => {
    expect(classifyBluePassMarket(["Gold Coast dive shop - our clients want Indonesia"])).toBe("INDONESIA");
    expect(classifyBluePassMarket(["I'm a Sydney-based agent, clients want Komodo, Indonesia"])).toBe("INDONESIA");
    expect(classifyBluePassMarket(["Bali shop sending guests to the Great Barrier Reef in Australia"])).toBe("AUSTRALIA");
    // no country named -> earliest place still wins
    expect(classifyBluePassMarket(["Gold Coast charters"])).toBe("AUSTRALIA");
    // both countries named -> earliest country wins
    expect(classifyBluePassMarket(["we're in Indonesia, not Australia"])).toBe("INDONESIA");
  });

  it("M7: matches needles on token boundaries, not bare substrings", () => {
    expect(classifyBluePassMarket(["flights via Balikpapan in Borneo"])).toBe("UNKNOWN"); // not "bali"
    expect(classifyBluePassMarket(["Hi, I'm Raja, a travel agent"])).toBe("UNKNOWN"); // bare "raja" dropped
    // genuine standalone place names still classify, including plurals
    expect(classifyBluePassMarket(["Raja Ampat in March"])).toBe("INDONESIA");
    expect(classifyBluePassMarket(["a Bali honeymoon"])).toBe("INDONESIA");
    expect(classifyBluePassMarket(["charter on the Whitsundays"])).toBe("AUSTRALIA"); // "whitsunday" + plural s
    // region aliases still resolve "raja" once the market is known, but not "Maharaja"
    expect(classifyBluePassRegion("INDONESIA", ["heading to Raja"])).toBe("Raja Ampat");
    expect(classifyBluePassRegion("INDONESIA", ["Maharaja Palace"])).toBeNull();
  });
});

describe("classifyBluePassRegion", () => {
  it("resolves Australian regions via aliases", () => {
    expect(classifyBluePassRegion("AUSTRALIA", ["out of Port Douglas"])).toBe("Great Barrier Reef");
    expect(classifyBluePassRegion("AUSTRALIA", ["Airlie Beach charters"])).toBe("Whitsundays");
    expect(classifyBluePassRegion("AUSTRALIA", ["Exmouth swims"])).toBe("Ningaloo Reef");
    expect(classifyBluePassRegion("AUSTRALIA", ["Rottnest day trip"])).toBe("Rottnest & Perth");
  });

  it("resolves Indonesian regions via aliases", () => {
    expect(classifyBluePassRegion("INDONESIA", ["Labuan Bajo"])).toBe("Komodo");
    expect(classifyBluePassRegion("INDONESIA", ["flying into Sorong"])).toBe("Raja Ampat");
  });

  it("returns null when no region is named", () => {
    expect(classifyBluePassRegion("AUSTRALIA", ["not sure yet"])).toBeNull();
    expect(classifyBluePassRegion("INDONESIA", ["somewhere warm"])).toBeNull();
  });
});

describe("market gate copy", () => {
  const EMOJI = /\p{Extended_Pictographic}/u;

  it("greeting asks country first, concise, no emoji", () => {
    const g = buildBluePassMarketGreeting();
    expect(g.toLowerCase()).toContain("australia or indonesia");
    expect(g.length).toBeLessThanOrEqual(320);
    expect(EMOJI.test(g)).toBe(false);
  });

  it("region prompt lists that market's regions, concise, no emoji", () => {
    for (const market of ["AUSTRALIA", "INDONESIA"] as const) {
      const prompt = buildBluePassRegionPrompt(market);
      expect(prompt.length, `${market} region prompt too long: ${prompt.length}`).toBeLessThanOrEqual(320);
      expect(EMOJI.test(prompt)).toBe(false);
      // every region in the market appears in its prompt
      for (const region of BLUEPASS_REGIONS[market]) {
        expect(prompt, `${market} prompt missing ${region}`).toContain(region);
      }
    }
  });

  it("resolveBluePassGate walks country -> region -> ready", () => {
    // nothing yet -> ask country
    const s1 = resolveBluePassGate(["hi"]);
    expect(s1.step).toBe("MARKET");
    expect(s1.prompt?.toLowerCase()).toContain("australia or indonesia");
    // country known, no region -> ask region for that coast
    const s2 = resolveBluePassGate(["hi", "we're in Australia"]);
    expect(s2.step).toBe("REGION");
    expect(s2.market).toBe("AUSTRALIA");
    expect(s2.prompt).toContain("Great Barrier Reef");
    // country + region -> READY, no prompt, market passed downstream
    const s3 = resolveBluePassGate(["hi", "we're in Australia", "on the Whitsundays"]);
    expect(s3.step).toBe("READY");
    expect(s3.market).toBe("AUSTRALIA");
    expect(s3.region).toBe("Whitsundays");
    expect(s3.prompt).toBeNull();
    // a single place name settles both at once (skips the gate)
    const s4 = resolveBluePassGate(["liveaboard out of Labuan Bajo"]);
    expect(s4.step).toBe("READY");
    expect(s4.market).toBe("INDONESIA");
    expect(s4.region).toBe("Komodo");
  });

  it("does not infinite-loop when a region names the other market (flips instead of looping)", () => {
    // nationality locks AUSTRALIA, but the named region is Komodo (Indonesia) -> flip, not a loop
    const g = resolveBluePassGate(["I'm Australian", "actually I want a liveaboard in Komodo, Indonesia"]);
    expect(g.step).toBe("READY");
    expect(g.market).toBe("INDONESIA");
    expect(g.region).toBe("Komodo");
    // and the reverse: locked Indonesia, but they name the Great Barrier Reef
    const g2 = resolveBluePassGate(["we're Indonesian", "but our clients want the Great Barrier Reef"]);
    expect(g2.step).toBe("READY");
    expect(g2.market).toBe("AUSTRALIA");
    expect(g2.region).toBe("Great Barrier Reef");
  });

  it("offers the whole AU coast (8 regions) and 2 live Indonesia regions", () => {
    expect(BLUEPASS_REGIONS.AUSTRALIA).toHaveLength(8);
    expect(BLUEPASS_REGIONS.AUSTRALIA).toContain("Great Barrier Reef");
    expect(BLUEPASS_REGIONS.AUSTRALIA).toContain("Tasmania");
    expect(BLUEPASS_REGIONS.INDONESIA).toEqual(["Komodo", "Raja Ampat"]);
  });
});
