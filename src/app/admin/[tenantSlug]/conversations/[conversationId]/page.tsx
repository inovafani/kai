import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { submitAdminTokenAction } from "../../../inquiries/actions";
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

function AdminAccess({ tenantSlug }: { tenantSlug: string }) {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#f5f7f6", color: "#10201c", padding: 24 }}>
      <section style={{ width: "min(100%, 420px)", border: "1px solid #dbe5e1", borderRadius: 8, background: "#ffffff", padding: 24 }}>
        <p style={{ margin: 0, color: "#0f766e", fontSize: 13, fontWeight: 800 }}>Kai Admin</p>
        <h1 style={{ margin: "8px 0 10px", fontSize: 30, lineHeight: 1.1 }}>Admin access</h1>
        <p style={{ margin: "0 0 18px", color: "#53655f", lineHeight: 1.5 }}>Enter the local admin token to view conversation transcripts.</p>
        <form action={submitAdminTokenAction} style={{ display: "grid", gap: 10 }}>
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <label style={{ display: "grid", gap: 6, color: "#53655f", fontSize: 13, fontWeight: 700 }}>
            Admin token
            <input
              name="token"
              type="password"
              autoComplete="current-password"
              style={{ border: "1px solid #b8cbc5", borderRadius: 8, fontSize: 16, padding: "11px 12px" }}
            />
          </label>
          <button
            type="submit"
            style={{ border: "1px solid #0f766e", borderRadius: 8, background: "#0f766e", color: "#ffffff", cursor: "pointer", fontSize: 15, fontWeight: 800, padding: "11px 12px" }}
          >
            Continue
          </button>
        </form>
      </section>
    </main>
  );
}

export default async function AdminConversationPage({ params }: AdminConversationPageProps) {
  const { tenantSlug, conversationId } = await params;
  const cookieStore = await cookies();
  const adminToken = cookieStore.get("kai_admin_token")?.value;
  const isAllowed = Boolean(process.env.KAI_ADMIN_TOKEN && adminToken === process.env.KAI_ADMIN_TOKEN);

  if (!isAllowed) {
    return <AdminAccess tenantSlug={tenantSlug} />;
  }

  const conversation = await findConversationTranscriptForTenantSlug({ tenantSlug, conversationId });
  if (!conversation) {
    notFound();
  }

  const inquiry = conversation.manualInquiries[0];

  return (
    <main style={{ minHeight: "100dvh", background: "#f5f7f6", color: "#10201c" }}>
      <section style={{ borderBottom: "1px solid #dbe5e1", background: "#ffffff" }}>
        <div style={{ width: "min(100%, 1120px)", margin: "0 auto", padding: "28px 24px" }}>
          <p style={{ margin: 0, color: "#0f766e", fontSize: 13, fontWeight: 800 }}>Kai Admin · {conversation.tenant.name}</p>
          <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <h1 style={{ margin: "6px 0 0", fontSize: 32, lineHeight: 1.1 }}>Conversation transcript</h1>
            <Link href={"/admin/" + tenantSlug + "/inquiries"} style={{ color: "#0f766e", fontWeight: 800, textDecoration: "none" }}>
              Back to inquiries
            </Link>
          </div>
        </div>
      </section>

      <section style={{ width: "min(100%, 1120px)", margin: "0 auto", padding: "22px 24px 56px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginBottom: 12 }}>
          <section style={{ border: "1px solid #dbe5e1", borderRadius: 8, background: "#ffffff", padding: 16 }}>
            <p style={{ margin: 0, color: "#62746e", fontSize: 13 }}>Inquiry</p>
            <h2 style={{ margin: "6px 0 10px", fontSize: 20 }}>{inquiry?.productTitle ?? conversation.bookingState?.productTitle ?? "Unknown product"}</h2>
            <p style={{ margin: 0, color: "#53655f", lineHeight: 1.5 }}>
              {(inquiry?.dateText ?? conversation.bookingState?.dateText ?? "Date unknown") + " · " + formatGuestCount(inquiry?.guests ?? conversation.bookingState?.guests)}
            </p>
          </section>

          <section style={{ border: "1px solid #dbe5e1", borderRadius: 8, background: "#ffffff", padding: 16 }}>
            <p style={{ margin: 0, color: "#62746e", fontSize: 13 }}>Conversation</p>
            <h2 style={{ margin: "6px 0 10px", fontSize: 20 }}>{conversation.controlMode}</h2>
            <p style={{ margin: 0, color: "#53655f", lineHeight: 1.5 }}>
              {conversation.channel} · {conversation.messages.length} messages
            </p>
          </section>
        </div>

        <section style={{ border: "1px solid #dbe5e1", borderRadius: 8, background: "#ffffff", padding: 18 }}>
          <h2 style={{ margin: "0 0 14px", fontSize: 18 }}>Messages</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {conversation.messages.map((message) => {
              const isTraveller = message.role === "TRAVELLER";
              return (
                <article
                  key={message.id}
                  style={{
                    justifySelf: isTraveller ? "end" : "start",
                    maxWidth: "min(100%, 720px)",
                    border: "1px solid " + (isTraveller ? "#0f766e" : "#dbe5e1"),
                    borderRadius: 8,
                    background: isTraveller ? "#0f766e" : "#f7faf9",
                    color: isTraveller ? "#ffffff" : "#10201c",
                    padding: 14
                  }}
                >
                  <div style={{ display: "flex", gap: 10, justifyContent: "space-between", marginBottom: 8 }}>
                    <strong style={{ fontSize: 12 }}>{message.role}</strong>
                    <span style={{ fontSize: 12, opacity: 0.78 }}>{formatCreatedAt(message.createdAt)}</span>
                  </div>
                  <p style={{ margin: 0, lineHeight: 1.55 }}>{message.content}</p>
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}
