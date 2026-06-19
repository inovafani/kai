import { describe, expect, it } from "vitest";
import { MockPmsAdapter } from "@/core/pms/mock-pms-adapter";
import { InseanqPmsAdapter } from "@/core/pms/inseanq-pms-adapter";
import { RezdyPmsAdapter } from "@/core/pms/rezdy-pms-adapter";
import { getPmsAdapter } from "./pms-adapter-registry";

describe("PMS adapter registry", () => {
  it("returns the mock adapter for MOCK tenants", () => {
    expect(getPmsAdapter("MOCK")).toBeInstanceOf(MockPmsAdapter);
  });

  it("returns a fail-closed Rezdy adapter shell", () => {
    expect(getPmsAdapter("REZDY")).toBeInstanceOf(RezdyPmsAdapter);
  });

  it("returns a fail-closed Inseanq adapter shell", () => {
    expect(getPmsAdapter("INSEANQ")).toBeInstanceOf(InseanqPmsAdapter);
  });
});
