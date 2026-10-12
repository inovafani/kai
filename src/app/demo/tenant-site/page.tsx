import Script from "next/script";

const experiences = [
        {  name: "Komodo Private Charter", detail: "8 hours", price: "From IDR 9.8M" },
        {  name: "Padar Sunrise Walk", detail: "4 hours", price: "From IDR 1.4M" },
        {  name: "Reef Day Snorkel", detail: "6 hours", price: "From IDR 2.2M" }
];

export default function DemoPage() {
  return (
    <div className="pub">
      <Script src="/embed/kai-loader.js" data-kai-key="pk_test_kai_demo" strategy="afterInteractive" />

      <header className="pub__bar">
        <span className="ds-body adm-strong">BluePass Experiences</span>
        <span className="adm-pill adm-pill--live">Demo site with Kai installed</span>
      </header>

      <section
        style={{
          minHeight: "58svh",
          display: "grid",
          alignItems: "end",
          padding: "40px var(--page-gutter)",
          background:
            "linear-gradient(180deg, rgba(10, 10, 9, 0.25), rgba(10, 10, 9, 0.92)), url('https://images.unsplash.com/photo-1516690561799-46d8f74f9abf?auto=format&fit=crop&w=1800&q=80') center/cover"
        }}
      >
        <div style={{ width: "min(100%, 1040px)", margin: "0 auto" }}>
          <span className="ds-caption pub__eyebrow">BluePass Experiences</span>
          <h1 className="pub__hero-title" style={{ maxWidth: "20ch" }}>
            BluePass Komodo Demo
          </h1>
          <p className="pub__lede">Private charters, island walks, and reef days.</p>
        </div>
      </section>

      <main className="pub__wrap" style={{ paddingTop: "var(--space-xxl)" }}>
        <div className="adm-grid">
          {experiences.map((experience) => (
            <article key={experience.name} className="adm-card">
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
