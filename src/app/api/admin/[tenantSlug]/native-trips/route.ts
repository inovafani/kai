import { NextResponse } from "next/server";
import { nativeTripErrorResponse, requireAdminToken } from "@/server/admin/admin-api-auth";
import { createNativeTrip, listNativeTrips } from "@/server/native/native-trip-service";

export const runtime = "nodejs";

type Props = { params: Promise<{ tenantSlug: string }> };

/** Lists an operator's trips. The BluePass operator screens call this on the operator's behalf. */
export async function GET(request: Request, { params }: Props) {
  const denied = requireAdminToken(request);
  if (denied) return denied;
  try {
    const { tenantSlug } = await params;
    return NextResponse.json({ trips: await listNativeTrips(tenantSlug) });
  } catch (error) {
    return nativeTripErrorResponse(error);
  }
}

/** Creates a draft trip. It is not shown to travellers until it is published. */
export async function POST(request: Request, { params }: Props) {
  const denied = requireAdminToken(request);
  if (denied) return denied;
  try {
    const { tenantSlug } = await params;
    const body = await request.json().catch(() => null);
    return NextResponse.json({ trip: await createNativeTrip(tenantSlug, body) }, { status: 201 });
  } catch (error) {
    return nativeTripErrorResponse(error);
  }
}
