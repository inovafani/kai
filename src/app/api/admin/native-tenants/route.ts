import { NextResponse } from "next/server";
import { z } from "zod";
import { createNativeTenant } from "@/server/tenant/create-native-tenant";

export const runtime = "nodejs";

const bodySchema = z.object({
  externalOperatorId: z.string().trim().min(1).max(128),
  name: z.string().trim().min(2).max(120),
  adminWhatsAppPhone: z.string().trim().max(32).nullish(),
  goLive: z.boolean().optional()
});

/**
 * Creates (or returns) the Kai tenant for a BluePass operator on the native booking system. The
 * BluePass app calls it when an admin onboards or approves an operator, and stores the returned slug
 * as the operator profile's kaiTenantSlug. Same KAI_ADMIN_TOKEN bearer/cookie auth as the other
 * admin endpoints. Idempotent on externalOperatorId.
 */
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

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "externalOperatorId and name are required.", issues: parsed.error.issues } },
      { status: 400 }
    );
  }

  const tenant = await createNativeTenant(parsed.data);
  return NextResponse.json({ tenant }, { status: tenant.created ? 201 : 200 });
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
