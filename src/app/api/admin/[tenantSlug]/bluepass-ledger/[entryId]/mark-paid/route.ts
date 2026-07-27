import { NextResponse } from "next/server";
import { markBluePassLedgerEntryPaid } from "@/server/bluepass/bluepass-inquiry-repository";
import { releaseBluePassLedgerEntryPayoutViaStripe } from "@/server/payments/bluepass-stripe";

export const runtime = "nodejs";

type MarkPaidRouteProps = {
  params: Promise<{ tenantSlug: string; entryId: string }>;
};

export async function POST(request: Request, { params }: MarkPaidRouteProps) {
  const expectedToken = process.env.KAI_ADMIN_TOKEN;
  const authorization = request.headers.get("authorization") ?? "";
  const bearerToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const cookieToken = readCookie(request.headers.get("cookie"), "kai_admin_token");

  if (!expectedToken || (bearerToken !== expectedToken && cookieToken !== expectedToken)) {
    return NextResponse.json(
      { error: { code: "ADMIN_TOKEN_REQUIRED", message: "Admin access is required." } },
      { status: 401 }
    );
  }

  const { entryId } = await params;
  const body = await request.json().catch(() => null);
  const reviewerEmail = typeof body?.reviewerEmail === "string" ? body.reviewerEmail.trim() : "";
  const stripeConnectAccountId =
    typeof body?.stripeConnectAccountId === "string" ? body.stripeConnectAccountId.trim() : "";

  // Two release paths share this endpoint: an admin-supplied Stripe Connect account id releases a
  // real Stripe transfer; otherwise this is the original manual bank-transfer attestation flow.
  if (stripeConnectAccountId) {
    if (!reviewerEmail) {
      return NextResponse.json(
        {
          error: {
            code: "MISSING_FIELDS",
            message: "reviewerEmail is required to release a ledger entry via Stripe transfer."
          }
        },
        { status: 400 }
      );
    }

    try {
      const entry = await releaseBluePassLedgerEntryPayoutViaStripe({ entryId, stripeConnectAccountId, reviewerEmail });
      return NextResponse.json({ entry });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to release the ledger entry via Stripe.";
      return NextResponse.json({ error: { code: "STRIPE_RELEASE_FAILED", message } }, { status: 400 });
    }
  }

  const paidOutReference = typeof body?.paidOutReference === "string" ? body.paidOutReference.trim() : "";

  if (!paidOutReference || !reviewerEmail) {
    return NextResponse.json(
      {
        error: {
          code: "MISSING_FIELDS",
          message: "paidOutReference and reviewerEmail are both required to mark a ledger entry paid."
        }
      },
      { status: 400 }
    );
  }

  try {
    const entry = await markBluePassLedgerEntryPaid({ entryId, paidOutReference, reviewerEmail });
    return NextResponse.json({ entry });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to mark the ledger entry paid.";
    return NextResponse.json({ error: { code: "MARK_PAID_FAILED", message } }, { status: 400 });
  }
}

function readCookie(cookieHeader: string | null, name: string) {
  if (!cookieHeader) {
    return undefined;
  }

  const prefix = `${name}=`;
  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
}
