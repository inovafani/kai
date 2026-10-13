import { NextResponse } from "next/server";
import { NativeTripError } from "@/server/native/native-trip-service";

/**
 * The same KAI_ADMIN_TOKEN bearer/cookie check the other admin endpoints use. Returns a 401
 * response to send back, or null when the caller is allowed.
 */
export function requireAdminToken(request: Request): NextResponse | null {
  const expectedToken = process.env.KAI_ADMIN_TOKEN;
  const authorization = request.headers.get("authorization") ?? "";
  const bearerToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const cookieToken = readCookie(request.headers.get("cookie"), "kai_admin_token");

  if (!expectedToken || (bearerToken !== expectedToken && cookieToken !== expectedToken)) {
    return NextResponse.json({ error: { code: "ADMIN_TOKEN_REQUIRED", message: "Admin access is required." } }, { status: 401 });
  }
  return null;
}

/** Turns a trip-service error into the JSON the BluePass operator screens show to a person. */
export function nativeTripErrorResponse(error: unknown) {
  if (error instanceof NativeTripError) {
    return NextResponse.json({ error: { code: error.code, message: error.message, issues: error.issues } }, { status: error.status });
  }
  console.error("native trip request failed", error);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong. Try again." } }, { status: 500 });
}

function readCookie(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return undefined;
  const prefix = `${name}=`;
  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
}
