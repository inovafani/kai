import Script from "next/script";

const experiences = [
  { id: "gold-coast-whale-escape", name: "Gold Coast Whale Escape", detail: "Luxury whale watching", price: "From AUD 99" },
  { id: "private-yacht-charter", name: "Private Yacht Charter", detail: "Tailored private yacht hire", price: "Operator quote" },
  { id: "corporate-charter", name: "Corporate Charter", detail: "Client hosting and team events", price: "Operator quote" },
  { id: "twilight-drift", name: "Twilight Drift", detail: "Sunset Broadwater cruise", price: "From AUD 79" },
  { id: "broadwater-twilight-dining", name: "Broadwater Twilight Dining", detail: "Evening dining cruise", price: "From AUD 149" }
];

export default function BoattimeDemoPage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#eef6f8",
        color: "#082633",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
      }}
    >
      <Script src="/embed/kai-loader.js" data-kai-key="pk_test_boattime" strategy="afterInteractive" />

      <section
        style={{
          minHeight: "74dvh",
          display: "grid",
          alignItems: "end",
          padding: "32px 24px",
          background:
            "linear-gradient(180deg, rgba(6, 38, 50, 0.08), rgba(6, 38, 50, 0.72)), url('https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?auto=format&fit=crop&w=1800&q=80') center/cover",
          color: "#ffffff"
        }}
      >
        <div style={{ width: "min(100%, 1080px)", margin: "0 auto" }}>
          <p style={{ margin: 0, fontWeight: 800, letterSpacing: 0 }}>Boattime Yacht Charters</p>
          <h1 style={{ maxWidth: 760, margin: "12px 0 16px", fontSize: 56, lineHeight: 1.02, letterSpacing: 0 }}>
            Gold Coast yacht charters and premium cruises.
          </h1>
          <p style={{ maxWidth: 600, margin: 0, fontSize: 20, lineHeight: 1.55 }}>
            Whale escapes, private charters, corporate events, weddings, and twilight dining on the Broadwater.
          </p>
        </div>
      </section>

      <section style={{ width: "min(100%, 1080px)", margin: "0 auto", padding: "36px 24px 96px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          {experiences.map((experience) => (
            <article id={experience.id} key={experience.name} style={{ border: "1px solid #cfe1e7", borderRadius: 8, background: "#ffffff", padding: 18 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{experience.name}</h2>
              <p style={{ margin: "10px 0 0", color: "#4e6670" }}>{experience.detail}</p>
              <p style={{ margin: "16px 0 0", fontWeight: 800 }}>{experience.price}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
