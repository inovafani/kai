/**
 * The chat widget runs inside customer websites. It wears the BluePass design system (the same dark
 * glass as the Kai panel on bluepass.co), with the tenant's own colour as a single accent on the
 * avatar. Its stylesheet is kai-widget.css; the frame around it belongs to the loader script.
 */
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <div className="embed-root">{children}</div>;
}
