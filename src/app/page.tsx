
const capabilities = [
  {
    title: "One conversation, three channels",
    body: "Travellers talk to Kai on WhatsApp, the BluePass website and by phone. It is the same brain, so a chat started in one place carries on in another."
  },
  {
    title: "Real availability, real holds",
    body: "Kai reads live availability from the operator's booking system, places a hold and sends a BluePass checkout link. It never promises a spot it has not checked."
  },
  {
    title: "Pay first, operator confirms",
    body: "Payment is taken at checkout. The operator then confirms, and if they cannot, the traveller is refunded automatically."
  },
  {
    title: "A person can step in",
    body: "Emergencies and requests for a person alert the team. Someone can take a chat over, Kai goes quiet, and hands back when they are done."
  }
];

const links = [
  { href: "/admin", label: "Open the console", primary: true },
  { href: "/demo/tenant-site", label: "Demo operator site", primary: false },
  { href: "/demo/boattime", label: "Demo with live booking", primary: false }
];

const systems = [
  { name: "BluePass booking system", status: "In build", tone: "live" },
  { name: "Mock sandbox", status: "Ready", tone: "good" },
  { name: "Rezdy and FareHarbor", status: "Paused", tone: "neutral" }
] as const;

export default function HomePage() {
  return (
    <div className="pub">
      <header className="pub__bar">
        <span className="adm-row">
          <span className="adm-nav__mark" aria-hidden="true">
            K
          </span>
          <span className="ds-body adm-strong">Kai</span>
        </span>
        <a href="https://bluepass.co" className="ds-caption">
          bluepass.co
        </a>
      </header>

      <main className="pub__wrap">
        <span className="ds-caption pub__eyebrow">Booking engine for BluePass</span>
        <h1 className="pub__hero-title">The booking rails behind the ocean.</h1>
        <p className="pub__lede">
          Kai takes a traveller from first question to confirmed trip: it chats, checks availability, holds the spot, takes
          payment and hands the operator a booking they can trust.
        </p>
        <div className="pub__actions">
          {links.map((link) => (
            <a key={link.href} href={link.href} className={link.primary ? "adm-btn adm-btn--primary" : "adm-btn"}>
              {link.label}
            </a>
          ))}
        </div>

        <section className="pub__section adm-stack">
          <h2 className="ds-subhead">What Kai does</h2>
          <div className="adm-grid">
            {capabilities.map((item) => (
              <article key={item.title} className="adm-card">
                <h3 className="ds-headline" style={{ marginBottom: 8 }}>
                  {item.title}
                </h3>
                <p className="ds-body-sm">{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="pub__section adm-stack">
          <h2 className="ds-subhead">Booking systems</h2>
          <div className="adm-card">
            <div className="adm-table-wrap">
              <table className="adm-table">
                <tbody>
                  {systems.map((system) => (
                    <tr key={system.name}>
                      <td className="adm-strong">{system.name}</td>
                      <td>
                        <span className={system.tone === "neutral" ? "adm-pill" : `adm-pill adm-pill--${system.tone}`}>{system.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="ds-body-sm">
            Each operator gets their own Kai tenant. Operators are onboarded by the BluePass team.
          </p>
        </section>
      </main>
    </div>
  );
}
