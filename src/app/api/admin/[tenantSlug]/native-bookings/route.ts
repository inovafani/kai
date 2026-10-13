import { NextResponse } from "next/server";
import { nativeTripErrorResponse, requireAdminToken } from "@/server/admin/admin-api-auth";
import { listNativeBookings } from "@/server/native/native-trip-service";

export const runtime = "nodejs";

type Props = { params: Promise<{ tenantSlug: string }> };

/** The operator's bookings. `?scope=pending` returns only what is waiting for an accept or decline. */
export async function GET(request: Request, { params }: Props) {
  const denied = requireAdminToken(request);
  if (denied) return denied;
  try {
    const { tenantSlug } = await params;
    const scope = new URL(request.url).searchParams.get("scope") === "pending" ? "pending" : "all";
    return NextResponse.json({ bookings: await listNativeBookings(tenantSlug, { scope }) });
  } catch (error) {
    return nativeTripErrorResponse(error);
  }
}
