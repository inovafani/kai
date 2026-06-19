export const requiredKaiEnvironmentKeys = [
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PMS_CREDENTIAL_ENCRYPTION_KEY",
  "KAI_ADMIN_TOKEN"
] as const;

export type RequiredKaiEnvironmentKey = (typeof requiredKaiEnvironmentKeys)[number];

export type KaiEnvironmentInput = Record<string, string | undefined>;

export interface KaiEnvironmentValidationResult {
  ok: boolean;
  missing: RequiredKaiEnvironmentKey[];
  placeholders: RequiredKaiEnvironmentKey[];
}

const placeholderPatterns = [/replace-me/i, /replace-with/i, /YOUR_PASSWORD/i, /PROJECT_REF/i, /REGION/i];

function isPlaceholder(value: string) {
  return placeholderPatterns.some((pattern) => pattern.test(value));
}

export function validateKaiEnvironment(env: KaiEnvironmentInput): KaiEnvironmentValidationResult {
  const missing: RequiredKaiEnvironmentKey[] = [];
  const placeholders: RequiredKaiEnvironmentKey[] = [];

  for (const key of requiredKaiEnvironmentKeys) {
    const value = env[key]?.trim();

    if (!value) {
      missing.push(key);
      continue;
    }

    if (isPlaceholder(value)) {
      placeholders.push(key);
    }
  }

  return {
    ok: missing.length === 0 && placeholders.length === 0,
    missing,
    placeholders
  };
}
