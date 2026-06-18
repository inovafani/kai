const principles = [
  "Tenant-first SaaS boundaries",
  "Deterministic booking tools",
  "Tenant-selected PMS adapters",
  "Portable BluePass migration path"
];

export default function HomePage() {
  return (
    <main style={{ margin: "0 auto", maxWidth: 960, padding: "64px 24px" }}>
      <p style={{ color: "var(--accent)", fontWeight: 700, margin: 0 }}>
        Kai SaaS Core
      </p>
      <h1 style={{ fontSize: 48, lineHeight: 1.05, margin: "12px 0 16px" }}>
        White-label AI booking orchestration.
      </h1>
      <p style={{ color: "var(--muted)", fontSize: 18, lineHeight: 1.6 }}>
        This standalone build proves Kai&apos;s tenant-safe booking loop before
        the core is ported into BluePass.
      </p>
      <section
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          marginTop: 32
        }}
      >
        {principles.map((principle) => (
          <div
            key={principle}
            style={{
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 18
            }}
          >
            {principle}
          </div>
        ))}
      </section>
    </main>
  );
}
