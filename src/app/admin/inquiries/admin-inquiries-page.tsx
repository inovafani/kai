import { AdminFrame, AdminGate, AdminHeader, humanize, Pill, Stat } from "../admin-ui";
import { updateManualInquiryStatusAction } from "./actions";
import { toManualInquiryViewModel } from "./manual-inquiry-view-model";
import { readAdminSession } from "@/server/admin/admin-session";
import { listBluePassInquiriesForTenantSlug } from "@/server/bluepass/bluepass-inquiry-repository";
import { listManualInquiriesForTenantSlug } from "@/server/conversation/conversation-repository";

function formatCreatedAt(date: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatCents(amountCents: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(amountCents / 100);
}

export async function AdminInquiriesPageView({ tenantSlug }: { tenantSlug: string }) {
  const session = await readAdminSession();

  if (!session.allowed) {
    return <AdminGate tenantSlug={tenantSlug} purpose="Enter the admin token to view manual inquiries." />;
  }

  const [inquiries, bluePassInquiries] = await Promise.all([
    listManualInquiriesForTenantSlug({ tenantSlug }),
    listBluePassInquiriesForTenantSlug({ tenantSlug })
  ]);
  const inquiryCards = inquiries.map(toManualInquiryViewModel);
  const openCount = inquiries.filter((inquiry) => inquiry.status === "OPEN").length;
  const tenantName = inquiries[0]?.tenant.name ?? bluePassInquiries[0]?.tenant.name ?? tenantSlug;

  return (
    <AdminFrame active="inquiries" tenantSlug={tenantSlug}>
      <AdminHeader
        title="Inquiries"
        context={tenantName}
        support="Requests Kai could not finish on its own, and every BluePass marketplace request routed to this operator."
      />

      <div className="adm-stack adm-stack--lg">
        <div className="adm-grid adm-grid--tight">
          <Stat label="Open" value={openCount} hint="Waiting on a person" icon="inbox" />
          <Stat label="All inquiries" value={inquiries.length} hint="Every request Kai handed over" icon="inquiries" />
          <Stat label="BluePass marketplace" value={bluePassInquiries.length} hint="Requests from bluepass.co" icon="bookings" />
        </div>

        {bluePassInquiries.length > 0 ? (
          <section className="adm-stack">
            <h2 className="ds-subhead">BluePass marketplace inquiries</h2>
            {bluePassInquiries.map((inquiry) => (
              <article key={inquiry.id} className="adm-card adm-inq">
                <div style={{ minWidth: 0 }}>
                  <div className="adm-row">
                    <h3 className="ds-headline">{inquiry.selectedYachtName ?? "BluePass inquiry"}</h3>
                    <Pill tone="live">{inquiry.status}</Pill>
                    {inquiry.dispatches[0] ? <Pill tone="good">{inquiry.dispatches[0].status}</Pill> : null}
                  </div>
                  <p className="ds-body-sm" style={{ marginTop: 8 }}>
                    {[inquiry.destination, inquiry.dateWindow, inquiry.guests ? `${inquiry.guests} guests` : null, inquiry.budget]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="ds-body-sm" style={{ marginTop: 6 }}>
                    {[inquiry.travellerName, inquiry.travellerEmail, inquiry.travellerPhone].filter(Boolean).join(" · ")}
                  </p>
                  {inquiry.referralCode ? (
                    <p className="ds-body adm-strong" style={{ marginTop: 8 }}>
                      Referral: {inquiry.referralRole ? `${inquiry.referralRole} / ` : null}
                      {inquiry.referralCode}
                    </p>
                  ) : null}
                  {inquiry.ledger.length > 0 ? (
                    <div className="adm-grid adm-grid--tight" style={{ marginTop: 12 }}>
                      {inquiry.ledger.map((entry) => (
                        <div key={entry.id} className="adm-inq__box" style={{ marginTop: 0 }}>
                          <p className="ds-caption">{humanize(entry.kind)}</p>
                          <strong className="ds-body adm-strong">{formatCents(entry.amountCents, entry.currency)}</strong>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <p className="ds-body" style={{ marginTop: 12 }}>
                    {inquiry.travellerMessage}
                  </p>
                </div>
                <div className="adm-inq__aside">
                  <span className="ds-caption">{formatCreatedAt(inquiry.createdAt)}</span>
                  <a href={"/admin/" + tenantSlug + "/conversations/" + inquiry.conversationId} className="adm-btn adm-btn--sm">
                    View conversation
                  </a>
                </div>
              </article>
            ))}
          </section>
        ) : null}

        <section className="adm-stack">
          <h2 className="ds-subhead">Manual inquiries</h2>
          {inquiries.length === 0 ? (
            <div className="adm-card">
              <p className="adm-empty">No manual inquiries yet.</p>
            </div>
          ) : (
            inquiryCards.map((inquiry) => {
              const failed = inquiry.bookingStatus === "FAILED";
              return (
                <article key={inquiry.id} className="adm-card adm-inq">
                  <div style={{ minWidth: 0 }}>
                    <div className="adm-row">
                      <h3 className="ds-headline">{inquiry.productTitle}</h3>
                      <Pill tone="good">{inquiry.status}</Pill>
                      {inquiry.bookingStatus ? <Pill tone={failed ? "bad" : "live"}>{inquiry.bookingStatus}</Pill> : null}
                    </div>
                    <p className="ds-body-sm" style={{ marginTop: 8 }}>
                      {inquiry.requestLine}
                    </p>
                    {inquiry.customerLine ? (
                      <p className="ds-body-sm" style={{ marginTop: 6 }}>
                        {inquiry.customerLine}
                      </p>
                    ) : null}
                    {inquiry.externalBookingId ? (
                      <p className="ds-body adm-strong" style={{ marginTop: 8 }}>
                        {inquiry.externalProvider ?? "PMS"} order:{" "}
                        <code title="Copy this order number exactly into the booking system." style={{ userSelect: "all" }}>
                          {inquiry.externalBookingId}
                        </code>
                      </p>
                    ) : null}
                    <div className={failed ? "adm-inq__box adm-inq__box--bad" : "adm-inq__box"}>
                      <p className="ds-body adm-strong">{inquiry.operatorReason}</p>
                      {inquiry.confirmationSummary ? (
                        <p className="ds-body" style={{ marginTop: 8 }}>
                          {inquiry.confirmationSummary}
                        </p>
                      ) : null}
                      {inquiry.bookingError ? (
                        <p className="ds-body-sm" style={{ marginTop: 8 }}>
                          PMS error: {inquiry.bookingError}
                        </p>
                      ) : null}
                      <p className="ds-body-sm" style={{ marginTop: 8 }}>
                        {inquiry.operatorNextStep}
                      </p>
                    </div>
                    <p className="ds-body" style={{ marginTop: 12 }}>
                      {inquiry.travellerMessage}
                    </p>
                  </div>
                  <div className="adm-inq__aside">
                    <span className="ds-caption">{formatCreatedAt(inquiry.createdAt)}</span>
                    <div className="adm-row" style={{ justifyContent: "flex-end" }}>
                      <a href={"/admin/" + tenantSlug + "/conversations/" + inquiry.conversationId} className="adm-btn adm-btn--sm">
                        View conversation
                      </a>
                      {inquiry.status === "OPEN" ? (
                        <form action={updateManualInquiryStatusAction}>
                          <input type="hidden" name="tenantSlug" value={tenantSlug} />
                          <input type="hidden" name="inquiryId" value={inquiry.id} />
                          <input type="hidden" name="status" value="OPERATOR_NOTIFIED" />
                          <button type="submit" className="adm-btn adm-btn--sm">
                            Mark notified
                          </button>
                        </form>
                      ) : null}
                      {inquiry.status !== "CLOSED" ? (
                        <form action={updateManualInquiryStatusAction}>
                          <input type="hidden" name="tenantSlug" value={tenantSlug} />
                          <input type="hidden" name="inquiryId" value={inquiry.id} />
                          <input type="hidden" name="status" value="CLOSED" />
                          <button type="submit" className="adm-btn adm-btn--primary adm-btn--sm">
                            Close
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>
    </AdminFrame>
  );
}
