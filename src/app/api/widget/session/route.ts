import { NextRequest, NextResponse } from "next/server";
import { createWidgetConversation } from "@/server/conversation/conversation-repository";
import { getWidgetRequestOrigin } from "@/server/widget/request-origin";
import { resolveWidgetRequest } from "@/server/widget/resolve-widget-request";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { key?: string } | null;
  const widgetKey = body?.key;

  if (!widgetKey) {
    return NextResponse.json(
      {
        error: {
          code: "WIDGET_KEY_REQUIRED",
          message: "Missing widget key."
        }
      },
      { status: 400 }
    );
  }

  const resolved = await resolveWidgetRequest({
    widgetKey,
    origin: getWidgetRequestOrigin(request)
  });

  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const conversation = await createWidgetConversation({
    tenantId: resolved.tenant.id
  });

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      tenantSlug: resolved.tenant.slug,
      channel: conversation.channel,
      controlMode: conversation.controlMode
    }
  });
}
