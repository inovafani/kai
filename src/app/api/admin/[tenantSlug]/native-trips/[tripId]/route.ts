import { NextResponse } from "next/server";
import { nativeTripErrorResponse, requireAdminToken } from "@/server/admin/admin-api-auth";
import { deleteNativeTrip, getNativeTrip, updateNativeTrip } from "@/server/native/native-trip-service";

export const runtime = "nodejs";

type Props = { params: Promise<{ tenantSlug: string; tripId: string }> };

export async function GET(request: Request, { params }: Props) {
  const denied = requireAdminToken(request);
  if (denied) return denied;
  try {
    const { tenantSlug, tripId } = await params;
    return NextResponse.json({ trip: await getNativeTrip(tenantSlug, tripId) });
  } catch (error) {
    return nativeTripErrorResponse(error);
  }
}

/** Replaces the trip's details, tickets, departure times and blocked dates with what was sent. */
export async function PUT(request: Request, { params }: Props) {
  const denied = requireAdminToken(request);
  if (denied) return denied;
  try {
    const { tenantSlug, tripId } = await params;
    const body = await request.json().catch(() => null);
    return NextResponse.json({ trip: await updateNativeTrip(tenantSlug, tripId, body) });
  } catch (error) {
    return nativeTripErrorResponse(error);
  }
}

/** Only a trip nobody has booked can be deleted; otherwise unpublish it. */
export async function DELETE(request: Request, { params }: Props) {
  const denied = requireAdminToken(request);
  if (denied) return denied;
  try {
    const { tenantSlug, tripId } = await params;
    await deleteNativeTrip(tenantSlug, tripId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return nativeTripErrorResponse(error);
  }
}
