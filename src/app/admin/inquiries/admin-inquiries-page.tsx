import Link from "next/link";
import { cookies } from "next/headers";
import { submitAdminTokenAction, updateManualInquiryStatusAction } from "./actions";
import { listManualInquiriesForTenantSlug } from "@/server/conversation/conversation-repository";

function formatGuestCount(guests: number | null) {
  return guests === 1 ? "1 guest" : String(guests ?? "Unknown") + " guests";
}

function formatCreatedAt(date: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export async function AdminInquiriesPageView({ tenantSlug }: { tenantSlug: string }) {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get("kai_admin_token")?.value;
  const isAllowed = Boolean(process.env.KAI_ADMIN_TOKEN && adminToken === process.env.KAI_ADMIN_TOKEN);

  if (!isAllowed) {
    return (
      <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#f5f7f6", color: "#10201c", padding: 24 }}>
        <section style={{ width: "min(100%, 420px)", border: "1px solid #dbe5e1", borderRadius: 8, background: "#ffffff", padding: 24 }}>
          <p style={{ margin: 0, color: "#0f766e", fontSize: 13, fontWeight: 800 }}>Kai Admin</p>
          <h1 style={{ margin: "8px 0 10px", fontSize: 30, lineHeight: 1.1 }}>Admin access</h1>
          <p style={{ margin: "0 0 18px", color: "#53655f", lineHeight: 1.5 }}>Enter the local admin token to view manual inquiries.</p>
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

  const inquiries = await listManualInquiriesForTenantSlug({ tenantSlug });
  const openCount = inquiries.filter((inquiry) => inquiry.status === "OPEN").length;
  const tenantName = inquiries[0]?.tenant.name ?? tenantSlug;

  return (
    <main style={{ minHeight: "100dvh", background: "#f5f7f6", color: "#10201c" }}>
      <section style={{ borderBottom: "1px solid #dbe5e1", background: "#ffffff" }}>
        <div style={{ width: "min(100%, 1120px)", margin: "0 auto", padding: "28px 24px" }}>
          <p style={{ margin: 0, color: "#0f766e", fontSize: 13, fontWeight: 800 }}>Kai Admin · {tenantName}</p>
          <h1 style={{ margin: "6px 0 0", fontSize: 32, lineHeight: 1.1 }}>Manual inquiries</h1>
        </div>
      </section>

      <section style={{ width: "min(100%, 1120px)", margin: "0 auto", padding: "22px 24px 56px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 18
          }}
        >
          <div style={{ border: "1px solid #dbe5e1", borderRadius: 8, background: "#ffffff", padding: 16 }}>
            <p style={{ margin: 0, color: "#62746e", fontSize: 13 }}>Open</p>
            <strong style={{ display: "block", marginTop: 6, fontSize: 28 }}>{openCount}</strong>
          </div>
          <div style={{ border: "1px solid #dbe5e1", borderRadius: 8, background: "#ffffff", padding: 16 }}>
            <p style={{ margin: 0, color: "#62746e", fontSize: 13 }}>Total captured</p>
            <strong style={{ display: "block", marginTop: 6, fontSize: 28 }}>{inquiries.length}</strong>
          </div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {inquiries.length === 0 ? (
            <div style={{ border: "1px solid #dbe5e1", borderRadius: 8, background: "#ffffff", padding: 18 }}>
              No manual inquiries yet.
            </div>
          ) : (
            inquiries.map((inquiry) => (
              <article
                key={inquiry.id}
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  border: "1px solid #dbe5e1",
                  borderRadius: 8,
                  background: "#ffffff",
                  padding: 16
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <h2 style={{ margin: 0, fontSize: 18 }}>{inquiry.productTitle ?? "Unknown product"}</h2>
                    <span
                      style={{
                        border: "1px solid #9acbc4",
                        borderRadius: 999,
                        color: "#0f766e",
                        fontSize: 12,
                        fontWeight: 800,
                        padding: "3px 8px"
                      }}
                    >
                      {inquiry.status}
                    </span>
                  </div>
                  <p style={{ margin: "8px 0 0", color: "#53655f" }}>
                    {inquiry.dateText ?? "Date unknown"} · {formatGuestCount(inquiry.guests)} · {inquiry.tenant.name}
                  </p>
                  <p style={{ margin: "12px 0 0", color: "#10201c" }}>{inquiry.travellerMessage}</p>
                </div>
                <div
                  style={{
                    display: "grid",
                    alignContent: "space-between",
                    justifyItems: "end",
                    gap: 10,
                    color: "#62746e",
                    fontSize: 13,
                    textAlign: "right",
                    whiteSpace: "nowrap"
                  }}
                >
                  <span>{formatCreatedAt(inquiry.createdAt)}</span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "end" }}>
                    <Link
                      href={"/admin/" + tenantSlug + "/conversations/" + inquiry.conversationId}
                      style={{
                        border: "1px solid #b8cbc5",
                        borderRadius: 8,
                        background: "#ffffff",
                        color: "#10201c",
                        fontWeight: 700,
                        padding: "8px 10px",
                        textDecoration: "none"
                      }}
                    >
                      View conversation
                    </Link>
                    {inquiry.status === "OPEN" ? (
                      <form action={updateManualInquiryStatusAction}>
                        <input type="hidden" name="tenantSlug" value={tenantSlug} />
                        <input type="hidden" name="inquiryId" value={inquiry.id} />
                        <input type="hidden" name="status" value="OPERATOR_NOTIFIED" />
                        <button
                          type="submit"
                          style={{
                            border: "1px solid #b8cbc5",
                            borderRadius: 8,
                            background: "#ffffff",
                            color: "#10201c",
                            cursor: "pointer",
                            fontWeight: 700,
                            padding: "8px 10px"
                          }}
                        >
                          Mark notified
                        </button>
                      </form>
                    ) : null}
                    {inquiry.status !== "CLOSED" ? (
                      <form action={updateManualInquiryStatusAction}>
                        <input type="hidden" name="tenantSlug" value={tenantSlug} />
                        <input type="hidden" name="inquiryId" value={inquiry.id} />
                        <input type="hidden" name="status" value="CLOSED" />
                        <button
                          type="submit"
                          style={{
                            border: "1px solid #0f766e",
                            borderRadius: 8,
                            background: "#0f766e",
                            color: "#ffffff",
                            cursor: "pointer",
                            fontWeight: 800,
                            padding: "8px 10px"
                          }}
                        >
                          Close
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
