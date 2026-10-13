import { NextResponse } from "next/server";
import { nativeTripErrorResponse, requireAdminToken } from "@/server/admin/admin-api-auth";
import { setNativeTripPublished } from "@/server/native/native-trip-service";

export const runtime = "nodejs";

type Props = { params: Promise<{ tenantSlug: string; tripId: string }> };

/** Body: { "published": true | false }. Publishing needs a priced ticket and a departure time. */
export async function POST(request: Request, { params }: Props) {
  const denied = requireAdminToken(request);
  if (denied) return denied;
  try {
    const { tenantSlug, tripId } = await params;
    const body = await request.json().catch(() => null);
    if (typeof body?.published !== "boolean") {
      return NextResponse.json({ error: { code: "INVALID_BODY", message: "published must be true or false." } }, { status: 400 });
    }
    return NextResponse.json({ trip: await setNativeTripPublished(tenantSlug, tripId, body.published) });
  } catch (error) {
    return nativeTripErrorResponse(error);
  }
}
