/** How long a paid native booking waits for the operator before it is refunded in full. */
export const OPERATOR_DECISION_HOURS = 24;

export type OperatorDecision = "ACCEPT" | "DECLINE" | "EXPIRE";

export function operatorDeadlineFrom(now: Date) {
  return new Date(now.getTime() + OPERATOR_DECISION_HOURS * 60 * 60 * 1000);
}

export function isPastOperatorDeadline(deadline: Date | null, now: Date) {
  return deadline !== null && deadline.getTime() <= now.getTime();
}
