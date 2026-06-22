import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { submitAdminTokenAction } from "../../inquiries/actions";
import { parsePublicProductCatalog } from "@/core/pms/public-product-catalog";
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

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre
      style={{
        margin: 0,
        overflowX: "auto",
        border: "1px solid #dbe5e1",
        borderRadius: 8,
        background: "#f7faf9",
        padding: 12,
        fontSize: 13,
        lineHeight: 1.55
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function ChipList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <span style={{ color: "#62746e" }}>None configured</span>;
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {items.map((item) => (
        <span
          key={item}
          style={{
            border: "1px solid #b8cbc5",
            borderRadius: 999,
            background: "#ffffff",
            color: "#10201c",
            fontSize: 13,
            fontWeight: 700,
            padding: "5px 9px"
          }}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function SettingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: "1px solid #dbe5e1", borderRadius: 8, background: "#ffffff", padding: 18 }}>
      <h2 style={{ margin: "0 0 14px", fontSize: 18 }}>{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <span style={{ color: "#62746e", fontSize: 13 }}>{label}</span>
      <strong style={{ fontSize: 15, lineHeight: 1.45 }}>{value}</strong>
    </div>
  );
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
    <div style={{ display: "grid", gap: 10 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1.15fr 1.15fr 0.72fr 0.68fr",
          gap: 8,
          color: "#53655f",
          fontSize: 12,
          fontWeight: 800
        }}
      >
        <span>Website product</span>
        <span>Product URL</span>
        <span>Description</span>
        <span>PMS code</span>
        <span>Mode</span>
      </div>
      {rows.map((mapping, index) => (
        <div
          key={index}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.15fr 1.15fr 0.72fr 0.68fr",
            gap: 8
          }}
        >
          <input
            aria-label={`Website product ${index + 1}`}
            name="productPublicTitle"
            defaultValue={mapping.publicTitle}
            placeholder="Gold Coast Whale Escape"
            style={{ border: "1px solid #b8cbc5", borderRadius: 8, fontSize: 13, padding: "9px 10px" }}
          />
          <input
            aria-label={`Product URL ${index + 1}`}
            name="productUrl"
            defaultValue={mapping.productUrl ?? ""}
            placeholder="https://example.com/product"
            style={{ border: "1px solid #b8cbc5", borderRadius: 8, fontSize: 13, padding: "9px 10px" }}
          />
          <input
            aria-label={`Product description ${index + 1}`}
            name="productPublicDescription"
            defaultValue={mapping.publicDescription}
            placeholder="Luxury whale watching"
            style={{ border: "1px solid #b8cbc5", borderRadius: 8, fontSize: 13, padding: "9px 10px" }}
          />
          <input
            aria-label={`PMS product code ${index + 1}`}
            name="productPmsProductId"
            defaultValue={mapping.pmsProductId}
            placeholder="PGG8QT"
            style={{ border: "1px solid #b8cbc5", borderRadius: 8, fontSize: 13, padding: "9px 10px" }}
          />
          <select
            aria-label={`Booking mode ${index + 1}`}
            name="productBookingMode"
            defaultValue={mapping.bookingMode}
            style={{ border: "1px solid #b8cbc5", borderRadius: 8, fontSize: 13, padding: "9px 10px" }}
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
  const cookieStore = await cookies();
  const adminToken = cookieStore.get("kai_admin_token")?.value;
  const isAllowed = Boolean(process.env.KAI_ADMIN_TOKEN && adminToken === process.env.KAI_ADMIN_TOKEN);

  if (!isAllowed) {
    return (
      <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#f5f7f6", color: "#10201c", padding: 24 }}>
        <section style={{ width: "min(100%, 420px)", border: "1px solid #dbe5e1", borderRadius: 8, background: "#ffffff", padding: 24 }}>
          <p style={{ margin: 0, color: "#0f766e", fontSize: 13, fontWeight: 800 }}>Kai Admin</p>
          <h1 style={{ margin: "8px 0 10px", fontSize: 30, lineHeight: 1.1 }}>Admin access</h1>
          <p style={{ margin: "0 0 18px", color: "#53655f", lineHeight: 1.5 }}>Enter the local admin token to view tenant settings.</p>
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

  const tenant = await findTenantSettingsBySlug(tenantSlug);
  const llm = getKaiLlmRuntimeSettings(process.env);
  if (!tenant) {
    notFound();
  }

  return (
    <main style={{ minHeight: "100dvh", background: "#f5f7f6", color: "#10201c" }}>
      <section style={{ borderBottom: "1px solid #dbe5e1", background: "#ffffff" }}>
        <div style={{ width: "min(100%, 1120px)", margin: "0 auto", padding: "28px 24px" }}>
          <p style={{ margin: 0, color: "#0f766e", fontSize: 13, fontWeight: 800 }}>Kai Admin · {tenant.name}</p>
          <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <h1 style={{ margin: "6px 0 0", fontSize: 32, lineHeight: 1.1 }}>Tenant settings</h1>
            <Link href={"/admin/" + tenant.slug + "/inquiries"} style={{ color: "#0f766e", fontWeight: 800, textDecoration: "none" }}>
              View inquiries
            </Link>
          </div>
        </div>
      </section>

      <section style={{ width: "min(100%, 1120px)", margin: "0 auto", padding: "22px 24px 56px" }}>
        {saved === "1" ? (
          <div style={{ border: "1px solid #9acbc4", borderRadius: 8, background: "#ecfdf8", color: "#0f766e", fontWeight: 800, marginBottom: 12, padding: 12 }}>
            Settings saved
          </div>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 12 }}>
          <SettingSection title="Tenant">
            <div style={{ display: "grid", gap: 14 }}>
              <Field label="Name" value={tenant.name} />
              <Field label="Slug" value={tenant.slug} />
              <Field label="Status" value={tenant.status} />
              <Field label="Default locale" value={tenant.defaultLocale} />
              <Field label="Widget public key" value={tenant.widgetPublicKey} />
            </div>
          </SettingSection>

          <SettingSection title="Branding">
            <div style={{ display: "grid", gap: 14 }}>
              <Field label="Widget title" value={tenant.branding?.widgetTitle ?? "Not configured"} />
              <Field label="Primary color" value={tenant.branding?.primaryColor ?? "Not configured"} />
              <Field label="Welcome message" value={tenant.branding?.welcomeMessage ?? "Not configured"} />
              <Field label="Brand voice" value={tenant.branding?.brandVoice ?? "Not configured"} />
            </div>
          </SettingSection>
        </div>

        <form action={"/api/admin/" + tenant.slug + "/settings"} method="post" style={{ border: "1px solid #dbe5e1", borderRadius: 8, background: "#ffffff", display: "grid", gap: 14, marginBottom: 12, padding: 18 }}>
          <input type="hidden" name="tenantSlug" value={tenant.slug} />
          <input type="hidden" name="adminToken" value={adminToken ?? ""} />
          <h2 style={{ margin: 0, fontSize: 18 }}>Edit operational settings</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, color: "#53655f", fontSize: 13, fontWeight: 700 }}>
              PMS provider
              <select name="pmsProvider" defaultValue={tenant.config?.pmsProvider ?? "MOCK"} style={{ border: "1px solid #b8cbc5", borderRadius: 8, fontSize: 15, padding: "10px 11px" }}>
                <option value="MOCK">MOCK</option>
                <option value="REZDY">REZDY</option>
                <option value="INSEANQ">INSEANQ</option>
                <option value="FAREHARBOR">FAREHARBOR</option>
                <option value="BOKUN">BOKUN</option>
                <option value="NATIVE">NATIVE</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, color: "#53655f", fontSize: 13, fontWeight: 700 }}>
              Allowed origins
              <textarea name="allowedOrigins" defaultValue={listToTextarea(tenant.allowedOrigins)} rows={5} style={{ border: "1px solid #b8cbc5", borderRadius: 8, fontSize: 14, lineHeight: 1.5, padding: "10px 11px", resize: "vertical" }} />
            </label>
            <label style={{ display: "grid", gap: 6, color: "#53655f", fontSize: 13, fontWeight: 700 }}>
              Enabled features
              <textarea name="enabledFeatures" defaultValue={listToTextarea(tenant.config?.enabledFeatures ?? [])} rows={5} style={{ border: "1px solid #b8cbc5", borderRadius: 8, fontSize: 14, lineHeight: 1.5, padding: "10px 11px", resize: "vertical" }} />
            </label>
            <label style={{ display: "grid", gap: 6, color: "#53655f", fontSize: 13, fontWeight: 700 }}>
              Brand voice
              <textarea name="brandVoice" defaultValue={tenant.branding?.brandVoice ?? ""} rows={5} style={{ border: "1px solid #b8cbc5", borderRadius: 8, fontSize: 14, lineHeight: 1.5, padding: "10px 11px", resize: "vertical" }} />
            </label>
            <label style={{ display: "grid", gap: 6, color: "#53655f", fontSize: 13, fontWeight: 700 }}>
              Response guardrails
              <textarea name="responseGuardrails" defaultValue={listToTextarea(tenant.config?.responseGuardrails ?? [])} rows={5} style={{ border: "1px solid #b8cbc5", borderRadius: 8, fontSize: 14, lineHeight: 1.5, padding: "10px 11px", resize: "vertical" }} />
            </label>
            <label style={{ alignSelf: "start", border: "1px solid #dbe5e1", borderRadius: 8, color: "#53655f", display: "flex", gap: 10, fontSize: 13, fontWeight: 700, padding: 12 }}>
              <input name="bookingWriteEnabled" type="checkbox" defaultChecked={tenant.config?.bookingWriteEnabled ?? false} />
              <span>
                Enable PMS booking-write
                <span style={{ display: "block", color: "#62746e", fontSize: 12, fontWeight: 500, lineHeight: 1.45, marginTop: 3 }}>
                  Keep off until the provider booking-write adapter has been tested.
                </span>
              </span>
            </label>
          </div>
          <section style={{ borderTop: "1px solid #e7efec", display: "grid", gap: 10, marginTop: 6, paddingTop: 14 }}>
            <h3 style={{ margin: 0, color: "#10201c", fontSize: 16 }}>Website product mapping</h3>
            <ProductMappingRows value={tenant.config?.publicProductCatalog} />
          </section>
          <div style={{ display: "flex", justifyContent: "end" }}>
            <button type="submit" style={{ border: "1px solid #0f766e", borderRadius: 8, background: "#0f766e", color: "#ffffff", cursor: "pointer", fontSize: 15, fontWeight: 800, padding: "10px 14px" }}>
              Save settings
            </button>
          </div>
        </form>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
          <SettingSection title="PMS and booking">
            <div style={{ display: "grid", gap: 14 }}>
              <Field label="PMS provider" value={tenant.config?.pmsProvider ?? "Not configured"} />
              <Field label="Booking mode" value={tenant.config?.bookingMode ?? "Not configured"} />
              <Field label="PMS booking-write" value={tenant.config?.bookingWriteEnabled ? "Enabled" : "Disabled"} />
              <Field label="Supported channels" value={<ChipList items={tenant.config?.supportedChannels ?? []} />} />
              <Field label="Enabled features" value={<ChipList items={tenant.config?.enabledFeatures ?? []} />} />
            </div>
          </SettingSection>

          <SettingSection title="Allowed origins">
            <ChipList items={tenant.allowedOrigins} />
          </SettingSection>

          <SettingSection title="LLM runtime">
            <div style={{ display: "grid", gap: 14 }}>
              <Field label="Enabled" value={llm.enabled ? "Yes" : "No"} />
              <Field label="Provider" value={llm.provider} />
              <Field label="Configured" value={llm.configured ? "Yes" : "No"} />
              <Field label="Model" value={llm.model ?? "Not configured"} />
              <Field label="Timeout" value={llm.timeoutMs + " ms"} />
              <Field label="Max output tokens" value={llm.maxOutputTokens} />
              <Field label="Warnings" value={<ChipList items={llm.warnings} />} />
            </div>
          </SettingSection>

          <SettingSection title="Escalation rules">
            <ChipList items={tenant.config?.escalationRules ?? []} />
          </SettingSection>

          <SettingSection title="Response guardrails">
            <div style={{ display: "grid", gap: 8 }}>
              {(tenant.config?.responseGuardrails ?? []).map((guardrail) => (
                <div key={guardrail} style={{ borderLeft: "3px solid #0f766e", paddingLeft: 10, color: "#10201c" }}>
                  {guardrail}
                </div>
              ))}
            </div>
          </SettingSection>

          <SettingSection title="Required slots">
            <JsonBlock value={tenant.config?.requiredSlots ?? {}} />
          </SettingSection>

          <SettingSection title="Website product mapping">
            <JsonBlock value={tenant.config?.publicProductCatalog ?? []} />
          </SettingSection>

          <SettingSection title="Integrations">
            {tenant.integrations.length === 0 ? (
              <p style={{ margin: 0, color: "#62746e" }}>No credentialed integrations configured yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {tenant.integrations.map((integration) => (
                  <div key={integration.provider} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <strong>{integration.provider}</strong>
                    <span style={{ color: "#62746e" }}>{integration.status}</span>
                  </div>
                ))}
              </div>
            )}
          </SettingSection>
        </div>
      </section>
    </main>
  );
}
