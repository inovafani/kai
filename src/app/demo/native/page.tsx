import Script from "next/script";

const experiences = [
  { id: "reef-snorkel", name: "Reef Snorkel", detail: "Two hours on the reef with a guide", price: "From US$60" },
  { id: "sunset-catamaran", name: "Sunset Catamaran", detail: "Evening sail, Wednesdays, Fridays and Saturdays", price: "US$95" }
];

export default function DemoPage() {
  return (
    <div className="pub">
      <Script src="/embed/kai-loader.js" data-kai-key="pk_test_native_demo" strategy="afterInteractive" />

      <header className="pub__bar">
        <span className="ds-body adm-strong">Blue Water Tours</span>
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
          <span className="ds-caption pub__eyebrow">Blue Water Tours</span>
          <h1 className="pub__hero-title" style={{ maxWidth: "20ch" }}>
            Reef snorkelling and sunset sails in Barbados.
          </h1>
          <p className="pub__lede">Live times and seats straight from the operator&apos;s own booking system on Kai.</p>
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
