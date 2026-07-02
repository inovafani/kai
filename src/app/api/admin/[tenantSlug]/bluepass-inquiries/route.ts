import { NextResponse } from "next/server";
import { listBluePassInquiriesForTenantSlug } from "@/server/bluepass/bluepass-inquiry-repository";

export const runtime = "nodejs";

type BluePassInquiriesRouteProps = {
  params: Promise<{ tenantSlug: string }>;
};

export async function GET(request: Request, { params }: BluePassInquiriesRouteProps) {
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

  const { tenantSlug } = await params;
  const url = new URL(request.url);
  const take = parseTake(url.searchParams.get("take"));
  const inquiries = await listBluePassInquiriesForTenantSlug({ tenantSlug, take });

  return NextResponse.json({ inquiries });
}

function parseTake(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return 40;
  }

  return Math.min(Math.max(parsed, 1), 100);
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
