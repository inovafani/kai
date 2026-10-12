export type NativeBookingStatusValue = "HELD" | "WAITING_OPERATOR" | "CONFIRMED" | "DECLINED" | "CANCELLED" | "EXPIRED";

export interface SeatClaim {
  status: NativeBookingStatusValue;
  seats: number;
  holdExpiresAt: Date;
}

/**
 * Whether a booking still occupies seats. Waiting-for-operator and confirmed bookings always do. A
 * hold only does until it expires, which is why an abandoned checkout frees its seats by itself and
 * nothing has to sweep them.
 */
export function claimsSeats(claim: SeatClaim, now: Date) {
  if (claim.status === "WAITING_OPERATOR" || claim.status === "CONFIRMED") return true;
  if (claim.status === "HELD") return claim.holdExpiresAt.getTime() > now.getTime();
  return false;
}

/** Seats left is never stored: it is the departure's seats minus what live bookings occupy. */
export function seatsLeft(departureSeats: number, claims: SeatClaim[], now: Date) {
  const taken = claims.reduce((sum, claim) => sum + (claimsSeats(claim, now) ? claim.seats : 0), 0);
  return Math.max(0, departureSeats - taken);
}
