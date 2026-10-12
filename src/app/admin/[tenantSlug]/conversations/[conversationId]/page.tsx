import { notFound } from "next/navigation";
import { AdminFrame, AdminGate, AdminHeader, Card, humanize, Pill } from "../../../admin-ui";
import { setConversationControlModeAction } from "./actions";
import { readAdminSession } from "@/server/admin/admin-session";
import { findConversationTranscriptForTenantSlug } from "@/server/conversation/conversation-repository";

export const dynamic = "force-dynamic";

type AdminConversationPageProps = {
  params: Promise<{ tenantSlug: string; conversationId: string }>;
};

function formatCreatedAt(date: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatGuestCount(guests: number | null | undefined) {
  return guests === 1 ? "1 guest" : String(guests ?? "Unknown") + " guests";
}

export default async function AdminConversationPage({ params }: AdminConversationPageProps) {
  const { tenantSlug, conversationId } = await params;
  const session = await readAdminSession();

  if (!session.allowed) {
    return <AdminGate tenantSlug={tenantSlug} purpose="Enter the admin token to view conversation transcripts." />;
  }

  const conversation = await findConversationTranscriptForTenantSlug({ tenantSlug, conversationId });
  if (!conversation) {
    notFound();
  }

  const inquiry = conversation.manualInquiries[0];
  const state = conversation.bookingState;
  const traveller = [
    inquiry?.travellerName ?? state?.travellerName,
    inquiry?.travellerEmail ?? state?.travellerEmail,
    inquiry?.travellerPhone ?? state?.travellerPhone
  ].filter(Boolean);
  const kaiHasChat = conversation.controlMode === "AI";
  // Only WhatsApp honours a take-over (the website chat has no way for a person to reply).
  const isWhatsApp = conversation.channel === "WHATSAPP";

  return (
    <AdminFrame active="inquiries" tenantSlug={tenantSlug}>
      <AdminHeader
        title="Conversation"
        context={conversation.tenant.name}
        support="The whole chat with this traveller, and whether Kai or a person is answering it."
        actions={
          <a href={"/admin/" + tenantSlug + "/inquiries"} className="adm-btn">
            Back to inquiries
          </a>
        }
      />

      <div className="adm-stack adm-stack--lg">
        <div className="adm-grid">
          <Card title="Booking state">
            <h3 className="ds-headline">{inquiry?.productTitle ?? state?.productTitle ?? "Unknown product"}</h3>
            <p className="ds-body-sm" style={{ marginTop: 8 }}>
              {(inquiry?.dateText ?? state?.dateText ?? "Date unknown") + " · " + formatGuestCount(inquiry?.guests ?? state?.guests)}
            </p>
            {state?.bookingStatus ? (
              <div style={{ marginTop: 10 }}>
                <Pill tone="live">{state.bookingStatus}</Pill>
              </div>
            ) : null}
            {traveller.length > 0 ? (
              <p className="ds-body-sm" style={{ marginTop: 10 }}>
                {traveller.join(" · ")}
              </p>
            ) : null}
            {state?.confirmationSummary ? (
              <p className="ds-body-sm" style={{ marginTop: 10 }}>
                {state.confirmationSummary}
              </p>
            ) : null}
          </Card>

          <Card title="Who has this chat">
            {isWhatsApp ? (
              <>
                <div className="adm-row">
                  <Pill tone={kaiHasChat ? "good" : "warn"}>{kaiHasChat ? "Kai is replying" : "A person has this chat"}</Pill>
                </div>
                <p className="ds-body-sm" style={{ marginTop: 10 }}>
                  WhatsApp · {conversation.messages.length} messages
                  {kaiHasChat ? "" : " · Kai stays quiet until it's handed back"}
                </p>
                <p className="ds-body-sm" style={{ marginTop: 6 }}>
                  {kaiHasChat
                    ? "Take over to answer this traveller yourself. Kai stops replying to them until you hand the chat back."
                    : "Reply to the traveller yourself, then hand the chat back so Kai answers again."}
                </p>
                <form action={setConversationControlModeAction} style={{ marginTop: 14 }}>
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="conversationId" value={conversationId} />
                  <input type="hidden" name="controlMode" value={kaiHasChat ? "HUMAN" : "AI"} />
                  <button type="submit" className={kaiHasChat ? "adm-btn" : "adm-btn adm-btn--primary"}>
                    {kaiHasChat ? "Take over this chat" : "Hand back to Kai"}
                  </button>
                </form>
              </>
            ) : (
              <>
                <div className="adm-row">
                  <Pill tone="good">Kai is replying</Pill>
                </div>
                <p className="ds-body-sm" style={{ marginTop: 10 }}>
                  Website chat · {conversation.messages.length} messages
                </p>
                <p className="ds-body-sm" style={{ marginTop: 6 }}>
                  A website chat can&apos;t be taken over: there is no way to reply into it, so Kai always answers here.
                  When a traveller asks for a person, Kai asks for their WhatsApp number and passes it to the team.
                </p>
                {!kaiHasChat ? (
                  /* Left over from before this card only offered take-over on WhatsApp. The website chat
                     ignores it either way; handing back just tidies the record. */
                  <form action={setConversationControlModeAction} style={{ marginTop: 14 }}>
                    <input type="hidden" name="tenantSlug" value={tenantSlug} />
                    <input type="hidden" name="conversationId" value={conversationId} />
                    <input type="hidden" name="controlMode" value="AI" />
                    <button type="submit" className="adm-btn">
                      Hand back to Kai
                    </button>
                  </form>
                ) : null}
              </>
            )}
          </Card>
        </div>

        <Card title="Messages">
          <div className="adm-thread">
            {conversation.messages.map((message) => {
              const isTraveller = message.role === "TRAVELLER";
              return (
                <article key={message.id} className={isTraveller ? "adm-bubble adm-bubble--traveller" : "adm-bubble"}>
                  <div className="adm-bubble__meta">
                    <strong>{message.role === "TRAVELLER" ? "Traveller" : message.role === "ASSISTANT" ? "Kai" : humanize(message.role)}</strong>
                    <span>{formatCreatedAt(message.createdAt)}</span>
                  </div>
                  <p>{message.content}</p>
                </article>
              );
            })}
          </div>
        </Card>
      </div>
    </AdminFrame>
  );
}
