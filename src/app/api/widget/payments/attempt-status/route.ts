import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// Read-only status lookup for the payment-return page to poll after a BluePass-Stripe checkout
// redirect. No separate auth token: the Stripe checkout session id is itself an unguessable
// token scoped to one attempt, the same trust model already used for BluePass quote page URLs.
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json(
      { error: { code: "SESSION_ID_REQUIRED", message: "Missing sessionId query parameter." } },
      { status: 400 }
    );
  }

  const attempt = await prisma.pmsBookingPaymentAttempt.findUnique({
    where: { stripeCheckoutSessionId: sessionId },
    select: {
      status: true,
      externalBookingId: true,
      productTitle: true,
      dateText: true,
      guests: true
    }
  });

  if (!attempt) {
    return NextResponse.json(
      { error: { code: "ATTEMPT_NOT_FOUND", message: "No payment attempt found for this session." } },
      { status: 404 }
    );
  }

  return NextResponse.json({ attempt });
}
