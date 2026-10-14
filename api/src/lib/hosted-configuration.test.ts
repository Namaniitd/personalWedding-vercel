import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configuredHostedSupabaseUrl,
  hasConfiguredHostedSupabaseUrl
} from "./hosted-configuration";

describe("hosted Supabase configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts only a canonical HTTPS hosted project origin", () => {
    vi.stubEnv("SUPABASE_URL", "https://project-ref.supabase.co");
    expect(configuredHostedSupabaseUrl()).toBe("https://project-ref.supabase.co");
    expect(hasConfiguredHostedSupabaseUrl()).toBe(true);
  });

  it("fails closed for non-HTTPS, noncanonical, and lookalike endpoints", () => {
    for (const value of [
      "http://project-ref.supabase.co",
      "https://project-ref.supabase.co/",
      "https://project-ref.supabase.co/rest/v1",
      "https://project-ref.supabase.co.attacker.example",
      "https://supabase.co",
      "https://user:password@project-ref.supabase.co"
    ]) {
      vi.stubEnv("SUPABASE_URL", value);
      expect(hasConfiguredHostedSupabaseUrl()).toBe(false);
      expect(() => configuredHostedSupabaseUrl()).toThrow("canonical HTTPS Supabase project URL");
    }
  });

  it("refuses the Node TLS verification bypass before a service key is used", () => {
    vi.stubEnv("SUPABASE_URL", "https://project-ref.supabase.co");
    vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
    expect(hasConfiguredHostedSupabaseUrl()).toBe(false);
    expect(() => configuredHostedSupabaseUrl()).toThrow("TLS certificate verification");
  });
});
