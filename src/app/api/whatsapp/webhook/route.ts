import { NextResponse } from "next/server";
import {
  handleBluePassOperatorResponse,
  recordBluePassTravellerWhatsAppDeliveryStatus,
  resolveLatestPendingBluePassInquiryIdForOperatorPhone
} from "@/server/bluepass/bluepass-inquiry-repository";
import {
  handleBluePassTravellerWhatsAppMessage,
  markBluePassWhatsAppHumanTakeover
} from "@/server/bluepass/bluepass-whatsapp-flow";
import {
  extractBluePassOperatorResponsesFromWhatsAppWebhook,
  extractBluePassTravellerMessagesFromWhatsAppWebhook,
  extractWhatsAppHumanAgentEchoesFromWebhook,
  extractWhatsAppMessageStatusesFromWebhook,
  verifyWhatsAppWebhookSignature
} from "@/server/whatsapp/webhook";

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
  const rawBody = await request.text();

  // Enforced only when META_APP_SECRET is configured, so existing deploys
  // keep working until the secret lands in env.
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (appSecret) {
    const valid = verifyWhatsAppWebhookSignature({
      rawBody,
      signatureHeader: request.headers.get("x-hub-signature-256"),
      appSecret
    });
    if (!valid) {
      return NextResponse.json({ ok: false, error: "Invalid webhook signature." }, { status: 403 });
    }
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = null;
  }

  const routing = { kaiPhoneNumberId: process.env.WHATSAPP_PHONE_ID_KAI ?? null };
  const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook(payload, routing);
  const travellerMessages = extractBluePassTravellerMessagesFromWhatsAppWebhook(payload, routing);
  const echoes = extractWhatsAppHumanAgentEchoesFromWebhook(payload);
  const statuses = extractWhatsAppMessageStatusesFromWebhook(payload);
  const failures: Array<{ inquiryId: string; reason: string }> = [];
  const statusFailures: Array<{ providerMessageId: string; reason: string }> = [];
  const travellerFailures: Array<{ fromPhone: string; reason: string }> = [];
  let handled = 0;
  let statusesHandled = 0;
  let travellerHandled = 0;
  let echoesHandled = 0;

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

  for (const message of travellerMessages) {
    try {
      const result = await handleBluePassTravellerWhatsAppMessage({
        fromPhone: message.fromPhone,
        content: message.content
      });
      if (result.status === "SEND_FAILED") {
        throw new Error(result.reason);
      }
      travellerHandled += 1;
    } catch (error) {
      travellerFailures.push({
        fromPhone: message.fromPhone,
        reason: error instanceof Error ? error.message : "Traveller message handling failed."
      });
    }
  }

  for (const echo of echoes) {
    try {
      await markBluePassWhatsAppHumanTakeover({ customerPhone: echo.customerPhone });
      echoesHandled += 1;
    } catch {
      // Takeover marking is best-effort; the human's reply already reached
      // the customer via the phone app.
    }
  }

  for (const status of statuses) {
    try {
      await recordBluePassTravellerWhatsAppDeliveryStatus(status);
      statusesHandled += 1;
    } catch (error) {
      statusFailures.push({
        providerMessageId: status.providerMessageId,
        reason: error instanceof Error ? error.message : "WhatsApp status callback failed."
      });
    }
  }

  return NextResponse.json({
    ok: true,
    handled,
    failed: failures.length,
    failures,
    travellerHandled,
    travellerFailed: travellerFailures.length,
    travellerFailures,
    echoesHandled,
    statusesHandled,
    statusesFailed: statusFailures.length,
    statusFailures
  });
}
