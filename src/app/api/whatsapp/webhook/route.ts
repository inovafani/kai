import { NextResponse } from "next/server";
import {
  handleBluePassOperatorResponse,
  resolveLatestPendingBluePassInquiryIdForOperatorPhone
} from "@/server/bluepass/bluepass-inquiry-repository";
import { extractBluePassOperatorResponsesFromWhatsAppWebhook } from "@/server/whatsapp/webhook";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200 });
  }

  return NextResponse.json({ ok: false, error: "Webhook verification failed." }, { status: 403 });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook(payload);
  const failures: Array<{ inquiryId: string; reason: string }> = [];
  let handled = 0;

  for (const response of responses) {
    try {
      const inquiryId =
        response.inquiryId ?? (await resolveLatestPendingBluePassInquiryIdForOperatorPhone(response.operatorPhone));
      if (!inquiryId) {
        throw new Error("No pending BluePass inquiry matched this operator response.");
      }

      await handleBluePassOperatorResponse({
        ...response,
        inquiryId
      });
      handled += 1;
    } catch (error) {
      failures.push({
        inquiryId: response.inquiryId ?? "unresolved",
        reason: error instanceof Error ? error.message : "Operator callback failed."
      });
    }
  }

  return NextResponse.json({
    ok: true,
    handled,
    failed: failures.length,
    failures
  });
}
