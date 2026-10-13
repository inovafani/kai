"use client";

/**
 * Chooses which operator the Inquiries and Tenant settings links point at. Each option shows its slug
 * as well as its name, since two tenants can share a display name.
 */
export function TenantPickerSelect({
  tenants,
  current,
  section
}: {
  tenants: { slug: string; name: string; kind: string }[];
  current: string;
  section: "inquiries" | "settings";
}) {
  return (
    <label className="shell-picker">
      <span className="shell-picker__label">Operator</span>
      <select
        className="shell-picker__select"
        value={current}
        // A full page load, so the browser shows its own loading spinner in the tab.
        onChange={(event) => window.location.assign(`/admin/${event.target.value}/${section}`)}
      >
        <optgroup label="Operators">
          {tenants
            .filter((tenant) => tenant.kind !== "PLATFORM")
            .map((tenant) => (
              <option key={tenant.slug} value={tenant.slug}>
                {tenant.name} ({tenant.slug})
              </option>
            ))}
        </optgroup>
        {tenants.some((tenant) => tenant.kind === "PLATFORM") ? (
          <optgroup label="BluePass chat">
            {tenants
              .filter((tenant) => tenant.kind === "PLATFORM")
              .map((tenant) => (
                <option key={tenant.slug} value={tenant.slug}>
                  {tenant.name} ({tenant.slug})
                </option>
              ))}
          </optgroup>
        ) : null}
      </select>
    </label>
  );
}
