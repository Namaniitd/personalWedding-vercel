import { afterEach, describe, expect, it, vi } from "vitest";

import { getDatabasePool, resetDatabaseRsvpPoolForTest } from "./database-rsvps";

describe("direct database runtime protection", () => {
  afterEach(async () => {
    await resetDatabaseRsvpPoolForTest();
    vi.unstubAllEnvs();
  });

  it("requires verify-full TLS and rejects Node's global TLS bypass outside development/test", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://invite.example.in");
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@database.example/shaadi?sslmode=require");
    expect(() => getDatabasePool()).toThrow("verified TLS");

    vi.stubEnv("DATABASE_URL", "postgresql://user:password@database.example/shaadi?sslmode=verify-full");
    expect(getDatabasePool()).toBeTruthy();

    vi.stubEnv("PGSSLMODE", "no-verify");
    expect(() => getDatabasePool()).toThrow("verified TLS");

    vi.stubEnv("PGSSLMODE", undefined);
    vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
    expect(() => getDatabasePool()).toThrow("verified TLS");
  });

  it("registers the Neon pool once with Vercel lifecycle handling and allows compute resume", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://invite.example.in");
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@ep-example-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full");

    const pool = getDatabasePool();
    expect(pool.listenerCount("release")).toBe(1);
    expect(getDatabasePool()).toBe(pool);
    expect(pool.listenerCount("release")).toBe(1);
    expect(pool.options.max).toBe(4);
    expect(pool.options.connectionTimeoutMillis).toBe(15_000);
    expect(pool.options.query_timeout).toBe(4_000);
  });

  it("keeps local pools on the normal Node lifecycle", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@127.0.0.1/shaadi");
    const pool = getDatabasePool();
    expect(pool.listenerCount("release")).toBe(0);
    expect(pool.options.connectionTimeoutMillis).toBe(4_000);
  });
});
