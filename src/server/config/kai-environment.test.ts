import { describe, expect, it } from "vitest";
import { validateKaiEnvironment } from "./kai-environment";

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
});
