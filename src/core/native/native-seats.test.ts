import { describe, expect, it } from "vitest";
import { claimsSeats, seatsLeft, type SeatClaim } from "./native-seats";

const now = new Date("2026-10-08T10:00:00Z");
const later = new Date("2026-10-08T10:30:00Z");
const earlier = new Date("2026-10-08T09:30:00Z");

const claim = (status: SeatClaim["status"], seats: number, holdExpiresAt = later): SeatClaim => ({ status, seats, holdExpiresAt });

describe("native seats", () => {
  it("counts held, waiting and confirmed bookings", () => {
    expect(seatsLeft(10, [claim("HELD", 2), claim("WAITING_OPERATOR", 3), claim("CONFIRMED", 1)], now)).toBe(4);
  });

  it("frees a hold on its own once it expires, with nothing to clean up", () => {
    expect(claimsSeats(claim("HELD", 4, earlier), now)).toBe(false);
    expect(seatsLeft(10, [claim("HELD", 4, earlier)], now)).toBe(10);
  });

  it("keeps seats for a paid booking even after its hold time passed", () => {
    expect(claimsSeats(claim("WAITING_OPERATOR", 4, earlier), now)).toBe(true);
    expect(claimsSeats(claim("CONFIRMED", 4, earlier), now)).toBe(true);
  });

  it("does not count declined, cancelled or expired bookings", () => {
    expect(seatsLeft(10, [claim("DECLINED", 5), claim("CANCELLED", 5), claim("EXPIRED", 5)], now)).toBe(10);
  });

  it("never goes below zero", () => {
    expect(seatsLeft(2, [claim("CONFIRMED", 5)], now)).toBe(0);
  });
});
