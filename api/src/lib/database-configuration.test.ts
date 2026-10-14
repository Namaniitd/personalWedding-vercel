import { afterEach, describe, expect, it, vi } from "vitest";

import {
  databaseEnvironmentRequestsVerifiedTls,
  databaseUrlConfiguration,
  databaseUrlRequestsVerifiedTls
} from "./database-configuration";

describe("direct database configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requires credentials and rejects connection-string destination overrides", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@database.example/shaadi?host=attacker.example");
    expect(() => databaseUrlConfiguration()).toThrow("host query override");

    vi.stubEnv("DATABASE_URL", "postgresql://user:password@database.example/shaadi");
    expect(databaseUrlConfiguration().url.hostname).toBe("database.example");
  });

  it("accepts only verify-full as the production TLS mode", () => {
    for (const value of [
      "postgresql://user:password@database.example/shaadi?sslmode=require",
      "postgresql://user:password@database.example/shaadi?ssl=true",
      "postgresql://user:password@database.example/shaadi?sslmode=disable",
      "postgresql://user:password@database.example/shaadi?sslmode=verify-full&ssl=true"
    ]) {
      vi.stubEnv("DATABASE_URL", value);
      expect(databaseUrlRequestsVerifiedTls(databaseUrlConfiguration().url)).toBe(false);
    }

    vi.stubEnv("DATABASE_URL", "postgresql://user:password@database.example/shaadi?sslmode=verify-full");
    expect(databaseUrlRequestsVerifiedTls(databaseUrlConfiguration().url)).toBe(true);
    expect(databaseEnvironmentRequestsVerifiedTls()).toBe(true);

    vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
    expect(databaseEnvironmentRequestsVerifiedTls()).toBe(false);

    vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", undefined);
    vi.stubEnv("PGSSLMODE", "no-verify");
    expect(databaseEnvironmentRequestsVerifiedTls()).toBe(false);
  });
});
