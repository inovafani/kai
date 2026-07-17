// Consolidates what used to be four independent copies of the same "leading 0 -> country code"
// rewrite (src/server/whatsapp/client.ts, bluepass-whatsapp-conversation.ts,
// bluepass-operator-directory.ts, bluepass-inquiry-repository.ts). The default of "62" (Indonesia)
// matches this codebase's existing behavior everywhere it was previously hardcoded - it does not
// yet make non-Indonesian local-format numbers (e.g. Australian "04...") resolve correctly, since
// that needs real per-tenant/per-operator country data that doesn't exist yet. This only removes
// the silent duplication and gives future region-aware work one place to change.

/**
 * Converts a local-format phone number (leading "0") to international format by replacing the
 * leading "0" with `defaultCountryCode`. Numbers that don't start with "0" pass through unchanged
 * (already-international format assumed).
 */
export function normalizeLocalPhone(value: string, defaultCountryCode = "62"): string {
  const digits = value.trim().replace(/[^\d]/g, "");
  if (!digits) return digits;

  return digits.startsWith("0") ? `${defaultCountryCode}${digits.slice(1)}` : digits;
}

/**
 * Inverse of normalizeLocalPhone: converts an already-digits-only international number back to
 * local format by replacing a matching country-code prefix with a leading "0". Returns null if
 * the digits don't start with that country code.
 */
export function internationalToLocalPhone(digits: string, countryCode = "62"): string | null {
  return digits.startsWith(countryCode) ? `0${digits.slice(countryCode.length)}` : null;
}
