import Link from "next/link";
import { AdminFrame, AdminGate, AdminHeader, Card, Pill, Stat } from "./admin-ui";
import { readAdminSession } from "@/server/admin/admin-session";
import { getAdminOverview, warmTenantPicker } from "@/server/admin/admin-overview";

type TenantRow = Awaited<ReturnType<typeof getAdminOverview>>["tenants"][number];

export const dynamic = "force-dynamic";

function formatMoney(amountCents: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(amountCents / 100);
}

function formatWhen(date: Date) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function tenantTone(status: string) {
  return status === "ACTIVE" ? "good" : status === "SUSPENDED" ? "warn" : "bad";
}

function cronTone(status: string) {
  return status === "SUCCESS" ? "good" : status === "PARTIAL" ? "warn" : "bad";
}

function TenantCard({ tenant }: { tenant: TenantRow }) {
  return (
    <div className="adm-card adm-card--tenant">
      <div className="adm-card__top">
        <Pill tone={tenantTone(tenant.status)}>{tenant.status}</Pill>
      </div>
      <h3 className="ds-headline">{tenant.name}</h3>
      <p className="ds-body-sm">
        {tenant.slug} · {tenant.config?.pmsProvider ?? "No PMS set"} ·{" "}
        {tenant.config?.bookingWriteEnabled ? "Booking-write on" : "Booking-write off"}
      </p>
      <p className="ds-body-sm">
        {tenant._count.conversations} conversations · {tenant._count.manualInquiries} inquiries
      </p>
      <div className="adm-card__actions">
        <Link href={`/admin/${tenant.slug}/inquiries`} className="adm-btn adm-btn--primary">
          Inquiries
        </Link>
        <Link href={`/admin/${tenant.slug}/settings`} className="adm-btn">
          Settings
        </Link>
      </div>
    </div>
  );
}

export default async function AdminOverviewPage() {
  const session = await readAdminSession();
  if (!session.allowed) {
    return <AdminGate tenantSlug="kai-demo" purpose="Enter the admin token to open the Kai console." />;
  }

  // Start the navigation frame's operator list now, so it loads alongside this page's own data.
  warmTenantPicker();

  const { tenants, platformTenants, testFixtureCount, stats, latestCronRuns, openInquiries, waitingInquiries } = await getAdminOverview();
  const regions = [
    { label: "Australia", region: stats.au },
    { label: "Indonesia", region: stats.indonesia }
  ];

  return (
    <AdminFrame active="overview">
      <AdminHeader
        title="Overview"
        support="Kai takes the booking, payment and operator confirmation behind BluePass. Everything here is read from the live database."
      />

      <div className="adm-stack adm-stack--lg">
        <div className="adm-grid adm-grid--tight">
          <Stat label="Operators on Kai" value={tenants.length} hint="One Kai tenant per operator" icon="operators" />
          <Stat label="Open inquiries" value={openInquiries} hint="Waiting on a person" icon="inbox" />
          {regions.map(({ label, region }) => (
            <Stat key={label} label={`${label} bookings`} value={region.bookingCount} hint="Paid and finalized" icon="bookings" />
          ))}
        </div>

        <section className="adm-stack">
          <h2 className="ds-subhead">Waiting on a person</h2>
          <p className="ds-body-sm">The newest inquiries nobody has handled yet, across every operator.</p>
          <Card>
            {waitingInquiries.length === 0 ? (
              <p className="adm-empty">Nothing is waiting.</p>
            ) : (
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <tbody>
                    {waitingInquiries.map((inquiry) => (
                      <tr key={inquiry.id}>
                        <td className="adm-strong">
                          <Link href={`/admin/${inquiry.tenant.slug}/inquiries`}>{inquiry.tenant.name}</Link>
                        </td>
                        <td>
                          {inquiry.travellerName ?? "A traveller"}
                          <span className="adm-muted">
                            {" "}
                            {[inquiry.productTitle, inquiry.dateText].filter(Boolean).join(" · ") || "asked a question"}
                          </span>
                        </td>
                        <td className="adm-muted">{formatWhen(inquiry.createdAt)}</td>
                        <td>
                          <Link href={`/admin/${inquiry.tenant.slug}/conversations/${inquiry.conversationId}`}>Open</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>

        <section className="adm-stack">
          <h2 className="ds-subhead">Operators</h2>
          <p className="ds-body-sm">Businesses that work with BluePass. Open one to see its inbox and settings.</p>
          {tenants.length === 0 ? (
            <p className="adm-empty">No operators yet.</p>
          ) : (
            <div className="adm-grid">
              {tenants.map((tenant) => (
                <TenantCard key={tenant.id} tenant={tenant} />
              ))}
            </div>
          )}
          {testFixtureCount > 0 ? (
            <p className="ds-body-sm">
              {testFixtureCount} more tenants were created by automated tests and are hidden here.
            </p>
          ) : null}
        </section>

        {platformTenants.length > 0 ? (
          <section className="adm-stack">
            <h2 className="ds-subhead">BluePass chat</h2>
            <p className="ds-body-sm">
              Kai on bluepass.co. It is not an operator: it recommends the operators above and hands the traveller to the one they pick.
            </p>
            <div className="adm-grid">
              {platformTenants.map((tenant) => (
                <TenantCard key={tenant.id} tenant={tenant} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="adm-stack">
          <h2 className="ds-subhead">Finalized ledger</h2>
          <div className="adm-grid adm-grid--wide">
            {regions.map(({ label, region }) => (
              <Card key={label} title={label}>
                {region.totalsByKindAndCurrency.length === 0 ? (
                  <p className="adm-empty">No finalized bookings yet.</p>
                ) : (
                  <div className="adm-table-wrap">
                    <table className="adm-table">
                      <tbody>
                        {region.totalsByKindAndCurrency.map((row) => (
                          <tr key={`${row.kind}-${row.currency}`}>
                            <td>{row.kind.replaceAll("_", " ").toLowerCase()}</td>
                            <td className="adm-strong">{formatMoney(row.amountCents, row.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </section>

        <section className="adm-stack">
          <div className="adm-row adm-row--between">
            <h2 className="ds-subhead">Background jobs</h2>
            <Link href="/admin/system" className="ds-caption">
              See all runs
            </Link>
          </div>
          <Card>
            {latestCronRuns.length === 0 ? (
              <p className="adm-empty">No job has run yet.</p>
            ) : (
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <tbody>
                    {latestCronRuns.map((run) => (
                      <tr key={run.id}>
                        <td className="adm-strong">{run.jobName}</td>
                        <td>
                          <Pill tone={cronTone(run.status)}>{run.status}</Pill>
                        </td>
                        <td className="adm-muted">{formatWhen(run.finishedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>
      </div>
    </AdminFrame>
  );
}
