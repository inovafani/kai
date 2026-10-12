/**
 * The chat widget runs inside customer websites and is branded by each tenant, so it keeps its own
 * light styling. The BluePass dark theme from the root stylesheet is switched off for these routes
 * (see `.embed-root` in globals.css).
 */
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <div className="embed-root">{children}</div>;
}
