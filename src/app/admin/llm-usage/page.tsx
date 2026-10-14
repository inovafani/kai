import { AdminFrame, AdminGate, AdminHeader, Card, Stat } from "../admin-ui";
import { warmTenantPicker } from "@/server/admin/admin-overview";
import { readAdminSession } from "@/server/admin/admin-session";
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
    <Stat
      label={title}
      value={formatUsd(totals.estimatedCostUsd)}
      hint={`${formatNumber(totals.calls)} calls · ${formatNumber(totals.totalTokens)} tokens`}
    />
  );
}

function GroupTable({ title, rows, keyLabel }: { title: string; rows: LlmUsageGroupTotals[]; keyLabel: string }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="adm-empty">No usage recorded yet.</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>{keyLabel}</th>
                <th>Calls</th>
                <th>Prompt tokens</th>
                <th>Completion tokens</th>
                <th>Total tokens</th>
                <th>Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="adm-strong">{row.key}</td>
                  <td>{formatNumber(row.calls)}</td>
                  <td>{formatNumber(row.promptTokens)}</td>
                  <td>{formatNumber(row.completionTokens)}</td>
                  <td>{formatNumber(row.totalTokens)}</td>
                  <td className="adm-strong">{formatUsd(row.estimatedCostUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default async function LlmUsagePage() {
  const session = await readAdminSession();

  if (!session.allowed) {
    return <AdminGate tenantSlug="llm-usage" purpose="Enter the admin token to view LLM usage." />;
  }

  // Start the navigation frame's operator list now, so it loads alongside this page's own data.
  warmTenantPicker();

  const summary = await getBluePassLlmUsageSummary();

  return (
    <AdminFrame active="llm-usage">
      <AdminHeader
        title="AI usage and cost"
        support="Estimated cost is calculated from a fixed per-token pricing table and should be verified against Groq's and OpenAI's current pricing pages. It is a directional estimate, not an invoice."
      />

      <div className="adm-stack adm-stack--lg">
        <div className="adm-grid adm-grid--tight">
          <SummaryCard title="Today" totals={summary.today} />
          <SummaryCard title="Last 7 days" totals={summary.last7Days} />
          <SummaryCard title="Last 30 days" totals={summary.last30Days} />
          <SummaryCard title="All time" totals={summary.allTime} />
        </div>

        <div className="adm-grid adm-grid--wide">
          <GroupTable title="By call type" rows={summary.byCallType} keyLabel="Call type" />
          <GroupTable title="By tenant" rows={summary.byTenant} keyLabel="Tenant" />
        </div>

        <Card title="Recent calls (last 50)">
          {summary.recentEvents.length === 0 ? (
            <p className="adm-empty">No usage recorded yet.</p>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Tenant</th>
                    <th>Call type</th>
                    <th>Provider / model</th>
                    <th>Tokens</th>
                    <th>Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recentEvents.map((event) => (
                    <tr key={event.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{event.createdAt.toLocaleString()}</td>
                      <td>{event.tenantName ?? "unknown"}</td>
                      <td>{event.callType}</td>
                      <td>
                        {event.provider} / {event.model}
                      </td>
                      <td>{formatNumber(event.totalTokens)}</td>
                      <td className="adm-strong">{event.estimatedCostUsd === null ? "n/a" : formatUsd(event.estimatedCostUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AdminFrame>
  );
}
