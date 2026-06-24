import { describe, expect, it } from "vitest";
import { getKaiLlmRuntimeSettings, validateKaiEnvironment } from "./kai-environment";

describe("validateKaiEnvironment", () => {
  const validEnvironment = {
    DATABASE_URL: "postgresql://postgres.example:secret@localhost:6543/postgres",
    DIRECT_URL: "postgresql://postgres:secret@localhost:5432/postgres",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_example",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_example",
    PMS_CREDENTIAL_ENCRYPTION_KEY: "01234567890123456789012345678901",
    KAI_ADMIN_TOKEN: "dev-admin-token"
  };

  it("accepts a complete local environment without exposing secret values", () => {
    expect(validateKaiEnvironment(validEnvironment)).toEqual({
      ok: true,
      missing: [],
      placeholders: []
    });
  });

  it("reports missing required environment values", () => {
    const result = validateKaiEnvironment({
      ...validEnvironment,
      DATABASE_URL: "",
      KAI_ADMIN_TOKEN: undefined
    });

    expect(result).toEqual({
      ok: false,
      missing: ["DATABASE_URL", "KAI_ADMIN_TOKEN"],
      placeholders: []
    });
  });

  it("reports placeholder values that should never reach a real runtime", () => {
    const result = validateKaiEnvironment({
      ...validEnvironment,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "replace-me",
      SUPABASE_SERVICE_ROLE_KEY: "replace-me",
      PMS_CREDENTIAL_ENCRYPTION_KEY: "replace-with-32-byte-base64-key"
    });

    expect(result).toEqual({
      ok: false,
      missing: [],
      placeholders: [
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "PMS_CREDENTIAL_ENCRYPTION_KEY"
      ]
    });
  });
  it("summarizes enabled Groq LLM runtime settings without exposing secrets", () => {
    expect(
      getKaiLlmRuntimeSettings({
        ENABLE_LLM: "true",
        LLM_PROVIDER: "groq",
        GROQ_API_KEY: "gsk-secret-value",
        GROQ_MODEL: "llama-test",
        GROQ_TIMEOUT_MS: "2500",
        LLM_MAX_OUTPUT_TOKENS: "180"
      })
    ).toEqual({
      enabled: true,
      provider: "groq",
      configured: true,
      model: "llama-test",
      timeoutMs: 2500,
      maxOutputTokens: 180,
      warnings: []
    });
  });

  it("defaults Groq to the 70B versatile model", () => {
    expect(
      getKaiLlmRuntimeSettings({
        ENABLE_LLM: "true",
        LLM_PROVIDER: "groq",
        GROQ_API_KEY: "gsk-secret-value"
      }).model
    ).toBe("llama-3.3-70b-versatile");
  });

  it("fails closed for unsupported LLM providers and clamps output token limits", () => {
    expect(
      getKaiLlmRuntimeSettings({
        ENABLE_LLM: "true",
        LLM_PROVIDER: "claude",
        LLM_MAX_OUTPUT_TOKENS: "9000"
      })
    ).toEqual({
      enabled: true,
      provider: "unsupported",
      configured: false,
      model: null,
      timeoutMs: 3000,
      maxOutputTokens: 500,
      warnings: ["Unsupported LLM provider: claude"]
    });
  });

});
