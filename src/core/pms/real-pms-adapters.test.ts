import { describe, expect, it } from "vitest";
import { InseanqPmsAdapter } from "./inseanq-pms-adapter";
import { RezdyPmsAdapter } from "./rezdy-pms-adapter";

const expectedMessage = "Real PMS adapter is configured but credentials/API mapping are not connected yet.";

describe("real PMS adapter shells", () => {
  it("exposes provider identity for Rezdy", async () => {
    const adapter = new RezdyPmsAdapter();

    expect(adapter.provider).toBe("REZDY");
    await expect(adapter.listProducts()).rejects.toThrow(expectedMessage);
  });

  it("exposes provider identity for Inseanq", async () => {
    const adapter = new InseanqPmsAdapter();

    expect(adapter.provider).toBe("INSEANQ");
    await expect(
      adapter.getAvailability({ productId: "inseanq-product", date: "tomorrow", guests: 2 })
    ).rejects.toThrow(expectedMessage);
  });
});
