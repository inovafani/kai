"use client";

import { useEffect, useState } from "react";

type AttemptStatus =
  | "AWAITING_PAYMENT"
  | "PAID_AWAITING_CONFIRM"
  | "CONFIRMED"
  | "PAYMENT_FAILED"
  | "CONFIRM_FAILED_REFUNDED"
  | "REFUND_FAILED";

type Attempt = {
  status: AttemptStatus;
  externalBookingId: string;
  productTitle: string;
  dateText: string;
  guests: number;
};

type PaymentReturnClientProps = {
  sessionId: string;
  cancelled: boolean;
};

const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 12;

function describeStatus(attempt: Attempt): { title: string; body: string } {
  switch (attempt.status) {
    case "CONFIRMED":
      return {
        title: "Booking confirmed",
        body: `Payment received - your booking for ${attempt.productTitle} on ${attempt.dateText} for ${attempt.guests} guest${
          attempt.guests === 1 ? "" : "s"
        } is confirmed. Booking reference: ${attempt.externalBookingId}.`
      };
    case "CONFIRM_FAILED_REFUNDED":
      return {
        title: "Not available - refunded",
        body: `${attempt.productTitle} on ${attempt.dateText} is no longer available, so your payment has been fully refunded. Nothing further is needed from you.`
      };
    case "REFUND_FAILED":
      return {
        title: "We're on it",
        body: `${attempt.productTitle} on ${attempt.dateText} is no longer available. Your refund is being processed manually by our team; you'll hear from us shortly.`
      };
    case "PAYMENT_FAILED":
      return {
        title: "Payment not completed",
        body: "Nothing was charged. You can return to the chat to try again."
      };
    default:
      return {
        title: "Finishing up your booking",
        body: "We're confirming your booking now - this only takes a moment."
      };
  }
}

export default function PaymentReturnClient({ sessionId, cancelled }: PaymentReturnClientProps) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState("");
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    if (!sessionId || cancelled) return;
    let active = true;

    async function poll() {
      try {
        const response = await fetch(`/api/widget/payments/attempt-status?sessionId=${encodeURIComponent(sessionId)}`);
        if (!active) return;
        if (!response.ok) {
          setError("We could not find this payment. If you were charged, please contact support.");
          return;
        }
        const data = (await response.json()) as { attempt: Attempt };
        setAttempt(data.attempt);
      } catch {
        if (active) setError("We could not check your payment status right now.");
      }
    }

    poll();
    const interval = setInterval(() => {
      setPollCount((count) => count + 1);
      poll();
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [sessionId, cancelled]);

  useEffect(() => {
    if (pollCount >= MAX_POLLS) {
      setError((current) => current || "This is taking longer than expected. You can close this tab and check back in chat shortly.");
    }
  }, [pollCount]);

  const isStillProcessing = attempt && (attempt.status === "AWAITING_PAYMENT" || attempt.status === "PAID_AWAITING_CONFIRM");

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
        background: "#f4f7f6"
      }}
    >
      <section
        style={{
          maxWidth: 420,
          width: "100%",
          padding: 24,
          borderRadius: 12,
          background: "#ffffff",
          boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
          textAlign: "center"
        }}
      >
        {cancelled ? (
          <>
            <h1 style={{ fontSize: 18, margin: 0 }}>Payment cancelled</h1>
            <p style={{ marginTop: 10, color: "#4f625b", fontSize: 14, lineHeight: 1.5 }}>
              Nothing was charged. You can return to the chat to try again whenever you&apos;re ready.
            </p>
          </>
        ) : attempt ? (
          <>
            <h1 style={{ fontSize: 18, margin: 0 }}>{describeStatus(attempt).title}</h1>
            <p style={{ marginTop: 10, color: "#4f625b", fontSize: 14, lineHeight: 1.5 }}>{describeStatus(attempt).body}</p>
            {isStillProcessing ? (
              <p style={{ marginTop: 14, color: "#8a9a94", fontSize: 12 }}>Checking again shortly...</p>
            ) : null}
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 18, margin: 0 }}>Checking your payment</h1>
            <p style={{ marginTop: 10, color: "#4f625b", fontSize: 14, lineHeight: 1.5 }}>
              {error || "One moment while we confirm your booking."}
            </p>
          </>
        )}
        <p style={{ marginTop: 18, color: "#8a9a94", fontSize: 12 }}>You can close this tab and return to the chat.</p>
      </section>
    </main>
  );
}
