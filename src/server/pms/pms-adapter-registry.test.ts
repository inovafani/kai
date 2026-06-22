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

  it("passes Rezdy environment credentials into the real adapter", async () => {
    const fetcher = async () =>
      new Response(JSON.stringify({ products: [{ id: "rz-1", title: "Rezdy Tour" }] }), { status: 200 });
    const adapter = getPmsAdapter(
      "REZDY",
      {
        REZDY_BASE_URL: "https://rezdy.example.test",
        REZDY_API_KEY: "rezdy-secret",
        REZDY_PRODUCT_LIST_PATH: "/products"
      },
      fetcher
    );

    await expect(adapter.listProducts()).resolves.toEqual([
      {
        externalProductId: "rz-1",
        title: "Rezdy Tour",
        description: "",
        bookingMode: "AUTO_BOOKING"
      }
    ]);
  });

  it("passes Inseanq environment credentials into the real adapter", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({ productId: "in-1", date: "2026-06-22", available: false, remaining: 0, unitPriceCents: 0 }),
        { status: 200 }
      );
    const adapter = getPmsAdapter(
      "INSEANQ",
      {
        INSEANQ_BASE_URL: "https://inseanq.example.test",
        INSEANQ_API_KEY: "inseanq-secret",
        INSEANQ_PRODUCT_LIST_PATH: "/products",
        INSEANQ_AVAILABILITY_PATH: "/availability"
      },
      fetcher
    );

    await expect(adapter.getAvailability({ productId: "in-1", date: "2026-06-22", guests: 2 })).resolves.toEqual({
      productId: "in-1",
      date: "2026-06-22",
      available: false,
      remaining: 0,
      currency: "USD",
      unitPriceCents: 0
    });
  });
});
