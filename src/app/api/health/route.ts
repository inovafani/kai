import { NextResponse } from "next/server";
import { getKaiLlmRuntimeSettings, validateKaiEnvironment } from "@/server/config/kai-environment";

export const runtime = "nodejs";

export function GET() {
  const environment = validateKaiEnvironment(process.env);
  const llm = getKaiLlmRuntimeSettings(process.env);

  return NextResponse.json({
    ok: true,
    service: "kai",
    version: "0.1.0",
    environment,
    llm
  });
}
