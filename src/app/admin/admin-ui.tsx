/* eslint-disable @next/next/no-html-link-for-pages -- plain links on purpose: a full page load makes the
   browser show its own loading spinner in the tab, which client-side navigation never does. */
import { listRealTenantsForPicker } from "@/server/admin/admin-overview";
import { submitAdminTokenAction } from "./inquiries/actions";
import { AdminIcon, type IconName } from "./admin-icons";
import { TenantPickerSelect } from "./tenant-picker";

export type AdminSection = "overview" | "settings" | "inquiries" | "llm-usage" | "system";

type NavItem = { id: AdminSection; label: string; href: string; icon: IconName };

function navGroups(tenantSlug: string): { label: string; items: NavItem[] }[] {
  return [
    {
      label: "Menu",
      items: [
        { id: "overview", label: "Overview", href: "/admin", icon: "overview" },
        { id: "inquiries", label: "Inquiries", href: `/admin/${tenantSlug}/inquiries`, icon: "inquiries" },
        { id: "settings", label: "Operator settings", href: `/admin/${tenantSlug}/settings`, icon: "settings" }
      ]
    },
    {
      label: "Platform",
      items: [
        { id: "llm-usage", label: "AI usage", href: "/admin/llm-usage", icon: "usage" },
        { id: "system", label: "Background jobs", href: "/admin/system", icon: "system" }
      ]
    }
  ];
}

/** The operator picker in the top bar; renders nothing if there are no operators. */
async function TenantPicker({ current, active }: { current?: string; active: AdminSection }) {
  const tenants = await listRealTenantsForPicker();
  if (tenants.length === 0) return null;
  const selected = current && tenants.some((tenant) => tenant.slug === current) ? current : tenants[0].slug;
  return <TenantPickerSelect tenants={tenants} current={selected} section={active === "settings" ? "settings" : "inquiries"} />;
}

/**
 * The console shell: a top bar (brand, operator, who is signed in), a side menu card, and the page.
 * Links are plain links (full page loads) on purpose: the browser then shows its own loading
 * spinner in the tab.
 */
export async function AdminFrame({
  active,
  tenantSlug,
  children
}: {
  active: AdminSection;
  tenantSlug?: string;
  children: React.ReactNode;
}) {
  // Without a tenant in the URL, the Inquiries and Operator settings links point at the operator with
  // the busiest inbox, which is the one an admin usually wants.
  const slug = tenantSlug ?? (await listRealTenantsForPicker())[0]?.slug ?? "kai-demo";
  return (
    <div className="shell">
      <header className="shell-top">
        <a href="/admin" className="shell-brand">
          <span className="shell-brand__mark" aria-hidden="true">
            K
          </span>
          <span className="shell-brand__name">Kai</span>
        </a>
        <span className="shell-top__spacer" />
        <TenantPicker current={slug} active={active} />
        <span className="shell-user">
          <span className="shell-user__avatar" aria-hidden="true">
            B
          </span>
          <span className="shell-user__text">
            <span className="shell-user__name">BluePass team</span>
            <span className="shell-user__role">Admin</span>
          </span>
        </span>
      </header>

      <div className="shell-body">
        <nav className="shell-side" aria-label="Kai admin">
          {navGroups(slug).map((group) => (
            <div className="shell-side__group" key={group.label}>
              <span className="shell-side__label">{group.label}</span>
              {group.items.map((item) => (
                <a
                  key={item.id}
                  href={item.href}
                  className={item.id === active ? "shell-side__link is-active" : "shell-side__link"}
                  aria-current={item.id === active ? "page" : undefined}
                >
                  <AdminIcon name={item.icon} />
                  <span>{item.label}</span>
                </a>
              ))}
            </div>
          ))}
          <div className="shell-side__foot">
            <a href="https://bluepass.co" className="shell-side__link">
              <AdminIcon name="external" />
              <span>Open bluepass.co</span>
            </a>
          </div>
        </nav>
        <main className="shell-main">{children}</main>
      </div>
    </div>
  );
}

/**
 * The page title with one plain sentence on what the page is for. `context` names what the page is
 * about (an operator, say) as a quiet chip beside the title.
 */
export function AdminHeader({
  title,
  context,
  support,
  actions
}: {
  title: string;
  context?: string;
  support?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="adm-head">
      <div className="adm-head__copy">
        <h1 className="adm-head__title">
          {title}
          {context ? <span className="adm-head__context">{context}</span> : null}
        </h1>
        {support ? <p className="ds-body adm-head__support">{support}</p> : null}
      </div>
      {actions ? <div className="adm-row">{actions}</div> : null}
    </header>
  );
}

/** Shown on any admin page when the session cookie is missing or wrong. */
export function AdminGate({ tenantSlug, purpose }: { tenantSlug: string; purpose: string }) {
  return (
    <main className="gate">
      <section className="adm-card gate__card">
        <span className="shell-brand__mark" aria-hidden="true">
          K
        </span>
        <h1 className="ds-headline">Sign in to Kai admin</h1>
        <p className="ds-body adm-head__support">{purpose}</p>
        <form action={submitAdminTokenAction} className="adm-form">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <label className="adm-field">
            <span className="adm-field__label">Admin token</span>
            <input name="token" type="password" autoComplete="current-password" className="adm-input" required />
          </label>
          <button type="submit" className="adm-btn adm-btn--primary">
            Continue
          </button>
        </form>
      </section>
    </main>
  );
}

type PillTone = "neutral" | "live" | "good" | "warn" | "bad";

/** "PAYMENT_PENDING" -> "Payment pending": raw database values read as plain words, never in capitals. */
export function humanize(value: string) {
  if (!/^[A-Z0-9_]+$/.test(value)) return value;
  const words = value.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function Pill({ tone = "neutral", children }: { tone?: PillTone; children: React.ReactNode }) {
  const className = tone === "neutral" ? "adm-pill" : `adm-pill adm-pill--${tone}`;
  return <span className={className}>{typeof children === "string" ? humanize(children) : children}</span>;
}

export function Card({ title, aside, children }: { title?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="adm-card">
      {title ? (
        <div className="adm-card__head">
          <h2 className="adm-card__title">{title}</h2>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, icon }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: IconName }) {
  return (
    <div className="adm-card adm-stat">
      <span className="adm-stat__label">{label}</span>
      {icon ? (
        <span className="adm-stat__icon">
          <AdminIcon name={icon} />
        </span>
      ) : null}
      <span className="adm-stat__value">{value}</span>
      {hint ? <span className="adm-stat__hint">{hint}</span> : null}
    </div>
  );
}

export function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="adm-kv">
      <span className="ds-caption adm-head__support">{label}</span>
      <strong className="ds-body adm-strong adm-kv__value">{value}</strong>
    </div>
  );
}

export function ChipList({ items, empty = "None configured" }: { items: string[]; empty?: string }) {
  if (items.length === 0) {
    return <span className="ds-body adm-head__support">{empty}</span>;
  }
  return (
    <div className="adm-chips">
      {items.map((item) => (
        <span className="adm-chip" key={item}>
          {item}
        </span>
      ))}
    </div>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  return <pre className="adm-json">{JSON.stringify(value, null, 2)}</pre>;
}
