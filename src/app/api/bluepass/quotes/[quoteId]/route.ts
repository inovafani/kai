import { NextResponse } from "next/server";
import { approveBluePassQuote, getBluePassQuote } from "@/server/bluepass/bluepass-quote";
import { createBluePassCheckoutSession } from "@/server/payments/bluepass-stripe";

export const runtime = "nodejs";

type BluePassQuoteRouteProps = {
  params: Promise<{ quoteId: string }>;
};

export async function GET(_request: Request, { params }: BluePassQuoteRouteProps) {
  const { quoteId } = await params;
  const quote = await getBluePassQuote({ quoteId });

  if (!quote) {
    return NextResponse.json({ error: { code: "QUOTE_NOT_FOUND", message: "Quote was not found." } }, { status: 404 });
  }

  return NextResponse.json({ quote });
}

export async function POST(request: Request, { params }: BluePassQuoteRouteProps) {
  const body = await request.json().catch(() => null);
  const action = body && typeof body === "object" && !Array.isArray(body) ? body.action : null;

  if (action !== "approve" && action !== "checkout") {
    return NextResponse.json(
      { error: { code: "INVALID_QUOTE_ACTION", message: "Quote action must be approve or checkout." } },
      { status: 400 }
    );
  }

  const { quoteId } = await params;

  if (action === "checkout") {
    try {
      const { checkoutUrl } = await createBluePassCheckoutSession({ quoteId });
      return NextResponse.json({ checkoutUrl });
    } catch (error) {
      return NextResponse.json(
        {
          error: {
            code: "CHECKOUT_SESSION_FAILED",
            message: error instanceof Error ? error.message : "Failed to create a checkout session."
          }
        },
        { status: 400 }
      );
    }
  }

  const quote = await approveBluePassQuote({ quoteId });

  return NextResponse.json({ quote });
}
