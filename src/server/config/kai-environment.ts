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

export type KaiLlmProvider = "groq" | "openai" | "unsupported";

export interface KaiLlmRuntimeSettings {
  enabled: boolean;
  provider: KaiLlmProvider;
  configured: boolean;
  model: string | null;
  timeoutMs: number;
  maxOutputTokens: number;
  warnings: string[];
}

const defaultLlmTimeoutMs = 3000;
const defaultLlmMaxOutputTokens = 260;
const minLlmMaxOutputTokens = 80;
const maxLlmMaxOutputTokens = 500;

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function getKaiLlmRuntimeSettings(env: KaiEnvironmentInput): KaiLlmRuntimeSettings {
  const enabled = env.ENABLE_LLM === "true" || env.ENABLE_OPENAI_LLM === "true";
  const requestedProvider = (env.LLM_PROVIDER ?? (env.ENABLE_OPENAI_LLM === "true" ? "openai" : "groq")).toLowerCase();
  const maxOutputTokens = clamp(
    parsePositiveInteger(env.LLM_MAX_OUTPUT_TOKENS, defaultLlmMaxOutputTokens),
    minLlmMaxOutputTokens,
    maxLlmMaxOutputTokens
  );

  if (requestedProvider !== "groq" && requestedProvider !== "openai") {
    return {
      enabled,
      provider: "unsupported",
      configured: false,
      model: null,
      timeoutMs: defaultLlmTimeoutMs,
      maxOutputTokens,
      warnings: ["Unsupported LLM provider: " + requestedProvider]
    };
  }

  const provider = requestedProvider;
  const keyName = provider === "groq" ? "GROQ_API_KEY" : "OPENAI_API_KEY";
  const model = provider === "groq" ? env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile" : env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
  const timeoutMs = parsePositiveInteger(
    provider === "groq" ? env.GROQ_TIMEOUT_MS : env.OPENAI_TIMEOUT_MS,
    defaultLlmTimeoutMs
  );
  const configured = Boolean(env[keyName]?.trim());
  const warnings: string[] = [];

  if (enabled && !configured) {
    warnings.push(keyName + " is required when " + provider + " LLM is enabled.");
  }

  return {
    enabled,
    provider,
    configured,
    model,
    timeoutMs,
    maxOutputTokens,
    warnings
  };
}
