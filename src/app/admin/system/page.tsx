import { AdminFrame, AdminGate, AdminHeader, Card, JsonBlock, Pill } from "../admin-ui";
import { readAdminSession } from "@/server/admin/admin-session";
import { listCronRuns, warmTenantPicker } from "@/server/admin/admin-overview";

export const dynamic = "force-dynamic";

function formatWhen(date: Date) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function tone(status: string) {
  return status === "SUCCESS" ? "good" : status === "PARTIAL" ? "warn" : "bad";
}

export default async function AdminSystemPage() {
  const session = await readAdminSession();
  if (!session.allowed) {
    return <AdminGate tenantSlug="kai-demo" purpose="Enter the admin token to view background jobs." />;
  }

  // Start the navigation frame's operator list now, so it loads alongside this page's own data.
  warmTenantPicker();

  const runs = await listCronRuns(50);

  return (
    <AdminFrame active="system">
      <AdminHeader
        title="Background jobs"
        support="Every scheduled job leaves a row here, so a job that stops running or starts failing shows up before an operator notices a missed payout."
      />
      <Card title="Last 50 runs">
        {runs.length === 0 ? (
          <p className="adm-empty">No job has run yet.</p>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Status</th>
                  <th>Finished</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="adm-strong">{run.jobName}</td>
                    <td>
                      <Pill tone={tone(run.status)}>{run.status}</Pill>
                    </td>
                    <td className="adm-muted">{formatWhen(run.finishedAt)}</td>
                    <td>
                      {run.errorMessage ? (
                        run.errorMessage
                      ) : run.summary ? (
                        <details>
                          <summary className="ds-caption" style={{ cursor: "pointer" }}>
                            Show result
                          </summary>
                          <JsonBlock value={run.summary} />
                        </details>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AdminFrame>
  );
}
