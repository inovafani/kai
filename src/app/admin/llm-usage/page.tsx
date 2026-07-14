import { cookies } from "next/headers";
import { submitAdminTokenAction } from "../inquiries/actions";
import { getBluePassLlmUsageSummary, type LlmUsageGroupTotals, type LlmUsagePeriodTotals } from "@/server/llm/llm-usage-repository";

export const dynamic = "force-dynamic";

function formatUsd(value: number) {
  return "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}

function SummaryCard({ title, totals }: { title: string; totals: LlmUsagePeriodTotals }) {
  return (
    <div style={{ border: "1px solid #dbe5e1", borderRadius: 8, background: "#ffffff", padding: 16 }}>
      <p style={{ margin: "0 0 8px", color: "#62746e", fontSize: 13, fontWeight: 700 }}>{title}</p>
      <p style={{ margin: "0 0 4px", fontSize: 26, fontWeight: 800, color: "#10201c" }}>{formatUsd(totals.estimatedCostUsd)}</p>
      <p style={{ margin: 0, color: "#53655f", fontSize: 13 }}>
        {formatNumber(totals.calls)} calls · {formatNumber(totals.totalTokens)} tokens
      </p>
    </div>
  );
}

function GroupTable({ title, rows, keyLabel }: { title: string; rows: LlmUsageGroupTotals[]; keyLabel: string }) {
  return (
    <section style={{ border: "1px solid #dbe5e1", borderRadius: 8, background: "#ffffff", padding: 18 }}>
      <h2 style={{ margin: "0 0 14px", fontSize: 18 }}>{title}</h2>
      {rows.length === 0 ? (
        <p style={{ margin: 0, color: "#62746e" }}>No usage recorded yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#62746e", fontSize: 12, fontWeight: 800 }}>
              <th style={{ padding: "0 8px 8px 0" }}>{keyLabel}</th>
              <th style={{ padding: "0 8px 8px" }}>Calls</th>
              <th style={{ padding: "0 8px 8px" }}>Prompt tokens</th>
              <th style={{ padding: "0 8px 8px" }}>Completion tokens</th>
              <th style={{ padding: "0 8px 8px" }}>Total tokens</th>
              <th style={{ padding: "0 0 8px 8px" }}>Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} style={{ borderTop: "1px solid #e7efec" }}>
                <td style={{ padding: "8px 8px 8px 0", fontWeight: 700 }}>{row.key}</td>
                <td style={{ padding: "8px" }}>{formatNumber(row.calls)}</td>
                <td style={{ padding: "8px" }}>{formatNumber(row.promptTokens)}</td>
                <td style={{ padding: "8px" }}>{formatNumber(row.completionTokens)}</td>
                <td style={{ padding: "8px" }}>{formatNumber(row.totalTokens)}</td>
                <td style={{ padding: "8px 0 8px 8px", fontWeight: 700 }}>{formatUsd(row.estimatedCostUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default async function LlmUsagePage() {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get("kai_admin_token")?.value;
  const isAllowed = Boolean(process.env.KAI_ADMIN_TOKEN && adminToken === process.env.KAI_ADMIN_TOKEN);

  if (!isAllowed) {
    return (
      <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#f5f7f6", color: "#10201c", padding: 24 }}>
        <section style={{ width: "min(100%, 420px)", border: "1px solid #dbe5e1", borderRadius: 8, background: "#ffffff", padding: 24 }}>
          <p style={{ margin: 0, color: "#0f766e", fontSize: 13, fontWeight: 800 }}>Kai Admin</p>
          <h1 style={{ margin: "8px 0 10px", fontSize: 30, lineHeight: 1.1 }}>Admin access</h1>
          <p style={{ margin: "0 0 18px", color: "#53655f", lineHeight: 1.5 }}>Enter the local admin token to view LLM usage.</p>
          <form action={submitAdminTokenAction} style={{ display: "grid", gap: 10 }}>
            <input type="hidden" name="tenantSlug" value="llm-usage" />
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

  const summary = await getBluePassLlmUsageSummary();

  return (
    <main style={{ minHeight: "100dvh", background: "#f5f7f6", color: "#10201c" }}>
      <section style={{ borderBottom: "1px solid #dbe5e1", background: "#ffffff" }}>
        <div style={{ width: "min(100%, 1120px)", margin: "0 auto", padding: "28px 24px" }}>
          <p style={{ margin: 0, color: "#0f766e", fontSize: 13, fontWeight: 800 }}>Kai Admin</p>
          <h1 style={{ margin: "6px 0 0", fontSize: 32, lineHeight: 1.1 }}>LLM usage &amp; cost</h1>
          <p style={{ margin: "8px 0 0", color: "#62746e", fontSize: 13, maxWidth: 640 }}>
            Estimated cost is calculated from a fixed per-token pricing table and should be verified against Groq&apos;s
            and OpenAI&apos;s current pricing pages - it is a directional estimate, not an invoice.
          </p>
        </div>
      </section>

      <section style={{ width: "min(100%, 1120px)", margin: "0 auto", padding: "22px 24px 56px", display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <SummaryCard title="Today" totals={summary.today} />
          <SummaryCard title="Last 7 days" totals={summary.last7Days} />
          <SummaryCard title="Last 30 days" totals={summary.last30Days} />
          <SummaryCard title="All time" totals={summary.allTime} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
          <GroupTable title="By call type" rows={summary.byCallType} keyLabel="Call type" />
          <GroupTable title="By tenant" rows={summary.byTenant} keyLabel="Tenant" />
        </div>

        <section style={{ border: "1px solid #dbe5e1", borderRadius: 8, background: "#ffffff", padding: 18 }}>
          <h2 style={{ margin: "0 0 14px", fontSize: 18 }}>Recent calls (last 50)</h2>
          {summary.recentEvents.length === 0 ? (
            <p style={{ margin: 0, color: "#62746e" }}>No usage recorded yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#62746e", fontSize: 12, fontWeight: 800 }}>
                    <th style={{ padding: "0 8px 8px 0" }}>Time</th>
                    <th style={{ padding: "0 8px 8px" }}>Tenant</th>
                    <th style={{ padding: "0 8px 8px" }}>Call type</th>
                    <th style={{ padding: "0 8px 8px" }}>Provider / model</th>
                    <th style={{ padding: "0 8px 8px" }}>Tokens</th>
                    <th style={{ padding: "0 0 8px 8px" }}>Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recentEvents.map((event) => (
                    <tr key={event.id} style={{ borderTop: "1px solid #e7efec" }}>
                      <td style={{ padding: "8px 8px 8px 0", whiteSpace: "nowrap" }}>{event.createdAt.toLocaleString()}</td>
                      <td style={{ padding: "8px" }}>{event.tenantName ?? "unknown"}</td>
                      <td style={{ padding: "8px" }}>{event.callType}</td>
                      <td style={{ padding: "8px" }}>
                        {event.provider} / {event.model}
                      </td>
                      <td style={{ padding: "8px" }}>{formatNumber(event.totalTokens)}</td>
                      <td style={{ padding: "8px 0 8px 8px", fontWeight: 700 }}>
                        {event.estimatedCostUsd === null ? "n/a" : formatUsd(event.estimatedCostUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
