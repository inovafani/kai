import { NextResponse } from "next/server";
import { approveBluePassQuote, getBluePassQuote } from "@/server/bluepass/bluepass-quote";

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

  if (!body || typeof body !== "object" || Array.isArray(body) || body.action !== "approve") {
    return NextResponse.json(
      { error: { code: "INVALID_QUOTE_ACTION", message: "Quote action must be approve." } },
      { status: 400 }
    );
  }

  const { quoteId } = await params;
  const quote = await approveBluePassQuote({ quoteId });

  return NextResponse.json({ quote });
}
