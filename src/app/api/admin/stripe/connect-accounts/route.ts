import { NextResponse } from "next/server";
import { createOrRefreshBluePassOperatorStripeConnectAccount } from "@/server/payments/bluepass-stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
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

  const body = await request.json().catch(() => null);
  const existingStripeAccountId =
    body && typeof body === "object" && !Array.isArray(body) && typeof body.existingStripeAccountId === "string"
      ? body.existingStripeAccountId
      : null;

  try {
    const result = await createOrRefreshBluePassOperatorStripeConnectAccount({ existingStripeAccountId });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "CONNECT_ACCOUNT_FAILED",
          message: error instanceof Error ? error.message : "Failed to create or refresh the Stripe Connect account."
        }
      },
      { status: 400 }
    );
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
