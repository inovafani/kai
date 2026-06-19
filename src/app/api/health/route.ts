import { NextResponse } from "next/server";
import { validateKaiEnvironment } from "@/server/config/kai-environment";

export const runtime = "nodejs";

export function GET() {
  const environment = validateKaiEnvironment(process.env);

  return NextResponse.json({
    ok: true,
    service: "kai",
    version: "0.1.0",
    environment
  });
}
