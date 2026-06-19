import Script from "next/script";

const tours = [
  {
    name: "Komodo Private Charter",
    duration: "8 hours",
    price: "From IDR 9.8M"
  },
  {
    name: "Padar Sunrise Walk",
    duration: "4 hours",
    price: "From IDR 1.4M"
  },
  {
    name: "Reef Day Snorkel",
    duration: "6 hours",
    price: "From IDR 2.2M"
  }
];

export default function DemoTenantSitePage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#f6fbf9",
        color: "#10201c",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
      }}
    >
      <Script src="/embed/kai-loader.js" data-kai-key="pk_test_kai_demo" strategy="afterInteractive" />

      <section
        style={{
          minHeight: "78dvh",
          display: "grid",
          alignItems: "end",
          padding: "32px 24px",
          background:
            "linear-gradient(180deg, rgba(4, 31, 26, 0.12), rgba(4, 31, 26, 0.72)), url('https://images.unsplash.com/photo-1516690561799-46d8f74f9abf?auto=format&fit=crop&w=1800&q=80') center/cover",
          color: "#ffffff"
        }}
      >
        <div style={{ width: "min(100%, 1080px)", margin: "0 auto" }}>
          <p style={{ margin: 0, fontWeight: 700, letterSpacing: 0 }}>BluePass Experiences</p>
          <h1
            style={{
              maxWidth: 720,
              margin: "12px 0 16px",
              fontSize: 56,
              lineHeight: 1.02,
              letterSpacing: 0
            }}
          >
            BluePass Komodo Demo
          </h1>
          <p style={{ maxWidth: 560, margin: 0, fontSize: 20, lineHeight: 1.55 }}>
            Private charters, island walks, and reef days.
          </p>
        </div>
      </section>

      <section style={{ width: "min(100%, 1080px)", margin: "0 auto", padding: "36px 24px 96px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14
          }}
        >
          {tours.map((tour) => (
            <article
              key={tour.name}
              style={{
                border: "1px solid #dce9e4",
                borderRadius: 8,
                background: "#ffffff",
                padding: 18
              }}
            >
              <h2 style={{ margin: 0, fontSize: 18 }}>{tour.name}</h2>
              <p style={{ margin: "10px 0 0", color: "#62746e" }}>{tour.duration}</p>
              <p style={{ margin: "16px 0 0", fontWeight: 800 }}>{tour.price}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
