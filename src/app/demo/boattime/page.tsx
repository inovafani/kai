import Script from "next/script";

const experiences = [
        { id: "gold-coast-whale-escape", name: "Gold Coast Whale Escape", detail: "Luxury whale watching", price: "From AUD 99" },
        { id: "private-yacht-charter", name: "Private Yacht Charter", detail: "Tailored private yacht hire", price: "Operator quote" },
        { id: "corporate-charter", name: "Corporate Charter", detail: "Client hosting and team events", price: "Operator quote" },
        { id: "twilight-drift", name: "Twilight Drift", detail: "Sunset Broadwater cruise", price: "From AUD 79" },
        { id: "broadwater-twilight-dining", name: "Broadwater Twilight Dining", detail: "Evening dining cruise", price: "From AUD 149" }
];

export default function DemoPage() {
  return (
    <div className="pub">
      <Script src="/embed/kai-loader.js" data-kai-key="pk_test_boattime" strategy="afterInteractive" />

      <header className="pub__bar">
        <span className="ds-body adm-strong">Boattime Yacht Charters</span>
        <span className="adm-pill adm-pill--live">Demo site with Kai installed</span>
      </header>

      <section
        style={{
          minHeight: "58svh",
          display: "grid",
          alignItems: "end",
          padding: "40px var(--page-gutter)",
          background:
            "linear-gradient(180deg, rgba(10, 10, 9, 0.25), rgba(10, 10, 9, 0.92)), url('https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?auto=format&fit=crop&w=1800&q=80') center/cover"
        }}
      >
        <div style={{ width: "min(100%, 1040px)", margin: "0 auto" }}>
          <span className="ds-caption pub__eyebrow">Boattime Yacht Charters</span>
          <h1 className="pub__hero-title" style={{ maxWidth: "20ch" }}>
            Gold Coast yacht charters and premium cruises.
          </h1>
          <p className="pub__lede">Whale escapes, private charters, corporate events, weddings, and twilight dining on the Broadwater.</p>
        </div>
      </section>

      <main className="pub__wrap" style={{ paddingTop: "var(--space-xxl)" }}>
        <div className="adm-grid">
          {experiences.map((experience) => (
            <article id={experience.id} key={experience.name} className="adm-card">
              <h2 className="ds-headline">{experience.name}</h2>
              <p className="ds-body-sm" style={{ marginTop: 8 }}>{experience.detail}</p>
              <p className="ds-body adm-strong" style={{ marginTop: 16 }}>{experience.price}</p>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
