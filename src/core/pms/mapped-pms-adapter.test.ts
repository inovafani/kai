import { describe, expect, it, vi } from "vitest";
import { MappedPmsAdapter } from "./mapped-pms-adapter";
import type { PmsAdapter, PmsProduct } from "./types";

describe("MappedPmsAdapter", () => {
  it("exposes website products and checks availability with the mapped PMS product id", async () => {
    const sourceAdapter: PmsAdapter = {
      provider: "REZDY",
      listProducts: vi.fn(async () => [
        {
          externalProductId: "rezdy-whale-ota",
          title: "(KLOOK) Luxury Whale Watching Experience",
          description: "",
          bookingMode: "AUTO_BOOKING"
        }
      ] satisfies PmsProduct[]),
      getAvailability: vi.fn(async () => ({
        productId: "rezdy-whale-direct",
        date: "tomorrow",
        available: true,
        remaining: 8,
        currency: "AUD",
        unitPriceCents: 9900
      })),
      createBooking: vi.fn(),
      cancelBooking: vi.fn(),
      getBooking: vi.fn()
    };

    const adapter = new MappedPmsAdapter(sourceAdapter, [
      {
        publicTitle: "Gold Coast Whale Escape",
        publicDescription: "Luxury whale watching",
        pmsProductId: "rezdy-whale-direct",
        productUrl: "https://tenant.example/whale",
        bookingMode: "AUTO_BOOKING",
        extraOptions: [{ label: "Corona Bucket", unitPriceCents: 3000 }]
      }
    ]);

    await expect(adapter.listProducts()).resolves.toEqual([
      {
        externalProductId: "rezdy-whale-direct",
        title: "Gold Coast Whale Escape",
        description: "Luxury whale watching",
        productUrl: "https://tenant.example/whale",
        bookingMode: "AUTO_BOOKING"
      }
    ]);

    await expect(
      adapter.getAvailability({ productId: "rezdy-whale-direct", date: "tomorrow", guests: 2 })
    ).resolves.toMatchObject({
      extraOptions: [{ label: "Corona Bucket", unitPriceCents: 3000 }]
    });

    expect(sourceAdapter.listProducts).not.toHaveBeenCalled();
    expect(sourceAdapter.getAvailability).toHaveBeenCalledWith({
      productId: "rezdy-whale-direct",
      date: "tomorrow",
      guests: 2
    });
  });
});
