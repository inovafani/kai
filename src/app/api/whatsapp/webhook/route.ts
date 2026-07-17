import { NextResponse } from "next/server";
import {
  handleBluePassOperatorResponse,
  recordBluePassTravellerWhatsAppDeliveryStatus,
  resolveLatestPendingBluePassInquiryIdForOperatorPhone
} from "@/server/bluepass/bluepass-inquiry-repository";
import { handleBluePassWhatsAppInboundMessage } from "@/server/bluepass/bluepass-whatsapp-conversation";
import { handleGenericWhatsAppInboundMessage } from "@/server/whatsapp/generic-whatsapp-conversation";
import { resolveWhatsAppGenericTenant } from "@/server/whatsapp/generic-tenant-router";
import {
  extractBluePassOperatorResponsesFromWhatsAppWebhook,
  extractWhatsAppInboundTextMessagesFromWebhook,
  extractWhatsAppMessageStatusesFromWebhook
} from "@/server/whatsapp/webhook";
import { sendWhatsAppTypingIndicator } from "@/server/whatsapp/client";

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
  const statuses = extractWhatsAppMessageStatusesFromWebhook(payload);
  const contextMessages = responses.length === 0 ? extractWhatsAppInboundTextMessagesFromWebhook(payload) : [];
  const failures: Array<{ inquiryId: string; reason: string }> = [];
  const statusFailures: Array<{ providerMessageId: string; reason: string }> = [];
  const contextFailures: Array<{ providerMessageId: string | null; reason: string }> = [];
  let handled = 0;
  let statusesHandled = 0;
  let contextHandled = 0;

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

  for (const message of contextMessages) {
    try {
      await sendWhatsAppTypingIndicator({
        role: "kai",
        messageId: message.providerMessageId ?? ""
      }).catch(() => undefined);

      const genericTenantMatch = await resolveWhatsAppGenericTenant(message.body);
      const result = genericTenantMatch
        ? await handleGenericWhatsAppInboundMessage(message, genericTenantMatch.tenant)
        : await handleBluePassWhatsAppInboundMessage(message);
      if (result.handled) {
        contextHandled += 1;
      }
    } catch (error) {
      contextFailures.push({
        providerMessageId: message.providerMessageId,
        reason: error instanceof Error ? error.message : "WhatsApp context message failed."
      });
    }
  }

  return NextResponse.json({
    ok: true,
    handled,
    failed: failures.length,
    failures,
    statusesHandled,
    statusesFailed: statusFailures.length,
    statusFailures,
    contextHandled,
    contextFailed: contextFailures.length,
    contextFailures
  });
}
