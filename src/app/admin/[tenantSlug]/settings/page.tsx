import { notFound } from "next/navigation";
import { AdminFrame, AdminGate, AdminHeader, Card, ChipList, JsonBlock, KeyValue, Pill } from "../../admin-ui";
import { parsePublicProductCatalog } from "@/core/pms/public-product-catalog";
import { readAdminSession } from "@/server/admin/admin-session";
import { getKaiLlmRuntimeSettings } from "@/server/config/kai-environment";
import { findTenantSettingsBySlug } from "@/server/tenant/tenant-repository";

export const dynamic = "force-dynamic";

type TenantSettingsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ saved?: string }>;
};

function listToTextarea(items: string[]) {
  return items.join("\n");
}

function ProductMappingRows({ value }: { value: unknown }) {
  const mappings = parsePublicProductCatalog(value);
  const rows = [
    ...mappings,
    ...Array.from({ length: Math.max(2, 6 - mappings.length) }, () => ({
      publicTitle: "",
      publicDescription: "",
      productUrl: "",
      pmsProductId: "",
      bookingMode: "AUTO_BOOKING" as const
    }))
  ];

  return (
    <div className="adm-stack">
      <div className="adm-mapping adm-mapping__head">
        <span>Website product</span>
        <span>Product URL</span>
        <span>Description</span>
        <span>PMS code</span>
        <span>Mode</span>
      </div>
      {rows.map((mapping, index) => (
        <div key={index} className="adm-mapping">
          <input
            aria-label={`Website product ${index + 1}`}
            name="productPublicTitle"
            defaultValue={mapping.publicTitle}
            placeholder="Gold Coast Whale Escape"
            className="adm-input"
          />
          <input
            aria-label={`Product URL ${index + 1}`}
            name="productUrl"
            defaultValue={mapping.productUrl ?? ""}
            placeholder="https://example.com/product"
            className="adm-input"
          />
          <input
            aria-label={`Product description ${index + 1}`}
            name="productPublicDescription"
            defaultValue={mapping.publicDescription}
            placeholder="Luxury whale watching"
            className="adm-input"
          />
          <input
            aria-label={`PMS product code ${index + 1}`}
            name="productPmsProductId"
            defaultValue={mapping.pmsProductId}
            placeholder="PGG8QT"
            className="adm-input"
          />
          <select
            aria-label={`Booking mode ${index + 1}`}
            name="productBookingMode"
            defaultValue={mapping.bookingMode}
            className="adm-select"
          >
            <option value="AUTO_BOOKING">Auto-book</option>
            <option value="MANUAL_INQUIRY">Manual</option>
          </select>
        </div>
      ))}
    </div>
  );
}

export default async function TenantSettingsPage({ params, searchParams }: TenantSettingsPageProps) {
  const { tenantSlug } = await params;
  const { saved } = await searchParams;
  const session = await readAdminSession();

  if (!session.allowed) {
    return <AdminGate tenantSlug={tenantSlug} purpose="Enter the admin token to view tenant settings." />;
  }

  const tenant = await findTenantSettingsBySlug(tenantSlug);
  const llm = getKaiLlmRuntimeSettings(process.env);
  if (!tenant) {
    notFound();
  }

  const statusTone = tenant.status === "ACTIVE" ? "good" : tenant.status === "SUSPENDED" ? "warn" : "bad";

  return (
    <AdminFrame active="settings" tenantSlug={tenant.slug}>
      <AdminHeader
        title="Operator settings"
        context={tenant.name}
        support="How Kai talks for this operator, which booking system it writes to, and which website products it knows about."
        actions={
          <a href={"/admin/" + tenant.slug + "/inquiries"} className="adm-btn">
            View inquiries
          </a>
        }
      />

      {saved === "1" ? <div className="adm-notice">Settings saved</div> : null}

      <div className="adm-stack adm-stack--lg">
        <div className="adm-grid">
          <Card title="Tenant">
            <KeyValue label="Name" value={tenant.name} />
            <KeyValue label="Slug" value={tenant.slug} />
            <KeyValue label="Status" value={<Pill tone={statusTone}>{tenant.status}</Pill>} />
            <KeyValue label="Default locale" value={tenant.defaultLocale} />
            <KeyValue label="Widget public key" value={tenant.widgetPublicKey} />
          </Card>

          <Card title="Branding">
            <KeyValue label="Widget title" value={tenant.branding?.widgetTitle ?? "Not configured"} />
            <KeyValue label="Primary color" value={tenant.branding?.primaryColor ?? "Not configured"} />
            <KeyValue label="Welcome message" value={tenant.branding?.welcomeMessage ?? "Not configured"} />
            <KeyValue label="Brand voice" value={tenant.branding?.brandVoice ?? "Not configured"} />
          </Card>
        </div>

        <form action={"/api/admin/" + tenant.slug + "/settings"} method="post" className="adm-card adm-form">
          <input type="hidden" name="tenantSlug" value={tenant.slug} />
          <input type="hidden" name="adminToken" value={session.token ?? ""} />
          <h2 className="ds-subhead">Edit operational settings</h2>
          <div className="adm-fields">
            <label className="adm-field">
              <span className="adm-field__label">PMS provider</span>
              <select name="pmsProvider" defaultValue={tenant.config?.pmsProvider ?? "MOCK"} className="adm-select">
                <option value="MOCK">MOCK</option>
                <option value="REZDY">REZDY</option>
                <option value="INSEANQ">INSEANQ</option>
                <option value="FAREHARBOR">FAREHARBOR</option>
                <option value="BOKUN">BOKUN</option>
                <option value="NATIVE">NATIVE (BluePass own booking system)</option>
              </select>
            </label>
            <label className="adm-field">
              <span className="adm-field__label">Allowed origins</span>
              <textarea name="allowedOrigins" defaultValue={listToTextarea(tenant.allowedOrigins)} rows={5} className="adm-textarea" />
            </label>
            <label className="adm-field">
              <span className="adm-field__label">Enabled features</span>
              <textarea name="enabledFeatures" defaultValue={listToTextarea(tenant.config?.enabledFeatures ?? [])} rows={5} className="adm-textarea" />
            </label>
            <label className="adm-field">
              <span className="adm-field__label">Brand voice</span>
              <textarea name="brandVoice" defaultValue={tenant.branding?.brandVoice ?? ""} rows={5} className="adm-textarea" />
            </label>
            <label className="adm-field">
              <span className="adm-field__label">Response guardrails</span>
              <textarea name="responseGuardrails" defaultValue={listToTextarea(tenant.config?.responseGuardrails ?? [])} rows={5} className="adm-textarea" />
            </label>
            <label className="adm-check">
              <input name="bookingWriteEnabled" type="checkbox" defaultChecked={tenant.config?.bookingWriteEnabled ?? false} />
              <span>
                <span className="ds-body adm-strong">Enable PMS booking-write</span>
                <span className="ds-body-sm" style={{ display: "block", marginTop: 3 }}>
                  Keep off until the provider booking-write adapter has been tested.
                </span>
              </span>
            </label>
          </div>
          <section className="adm-stack">
            <h3 className="ds-subhead">Website product mapping</h3>
            <ProductMappingRows value={tenant.config?.publicProductCatalog} />
          </section>
          <div className="adm-row" style={{ justifyContent: "flex-end" }}>
            <button type="submit" className="adm-btn adm-btn--primary">
              Save settings
            </button>
          </div>
        </form>

        <div className="adm-grid adm-grid--wide">
          <Card title="PMS and booking">
            <KeyValue label="PMS provider" value={tenant.config?.pmsProvider ?? "Not configured"} />
            <KeyValue label="Booking mode" value={tenant.config?.bookingMode ?? "Not configured"} />
            <KeyValue
              label="PMS booking-write"
              value={<Pill tone={tenant.config?.bookingWriteEnabled ? "good" : "neutral"}>{tenant.config?.bookingWriteEnabled ? "Enabled" : "Disabled"}</Pill>}
            />
            <KeyValue label="Supported channels" value={<ChipList items={tenant.config?.supportedChannels ?? []} />} />
            <KeyValue label="Enabled features" value={<ChipList items={tenant.config?.enabledFeatures ?? []} />} />
          </Card>

          <Card title="Allowed origins">
            <ChipList items={tenant.allowedOrigins} />
          </Card>

          <Card title="LLM runtime">
            <KeyValue label="Enabled" value={llm.enabled ? "Yes" : "No"} />
            <KeyValue label="Provider" value={llm.provider} />
            <KeyValue label="Configured" value={llm.configured ? "Yes" : "No"} />
            <KeyValue label="Model" value={llm.model ?? "Not configured"} />
            <KeyValue label="Timeout" value={llm.timeoutMs + " ms"} />
            <KeyValue label="Max output tokens" value={llm.maxOutputTokens} />
            <KeyValue label="Warnings" value={<ChipList items={llm.warnings} empty="None" />} />
          </Card>

          <Card title="Escalation rules">
            <ChipList items={tenant.config?.escalationRules ?? []} />
          </Card>

          <Card title="Response guardrails">
            <div className="adm-stack">
              {(tenant.config?.responseGuardrails ?? []).map((guardrail) => (
                <div key={guardrail} className="adm-quote ds-body">
                  {guardrail}
                </div>
              ))}
            </div>
          </Card>

          <Card title="Required slots">
            <JsonBlock value={tenant.config?.requiredSlots ?? {}} />
          </Card>

          <Card title="Website product mapping">
            <JsonBlock value={tenant.config?.publicProductCatalog ?? []} />
          </Card>

          <Card title="Integrations">
            {tenant.integrations.length === 0 ? (
              <p className="adm-empty">No credentialed integrations configured yet.</p>
            ) : (
              <div className="adm-stack">
                {tenant.integrations.map((integration) => (
                  <div key={integration.provider} className="adm-row adm-row--between">
                    <strong className="ds-body adm-strong">{integration.provider}</strong>
                    <Pill>{integration.status}</Pill>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </AdminFrame>
  );
}
