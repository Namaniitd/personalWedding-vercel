import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDatabasePool: vi.fn(), query: vi.fn() }));
vi.mock("./database-rsvps", () => ({ getDatabasePool: mocks.getDatabasePool }));

import { sharedRateLimitSchema, takeDatabaseRateLimit } from "./database-rate-limit";
import { takeRateLimit } from "./rate-limit";

const input = { keyHash: "a".repeat(64), maxRequests: 1, windowMs: 120_000 };

describe("shared database rate limiter", () => {
  beforeEach(() => {
    mocks.getDatabasePool.mockReset().mockReturnValue({ query: mocks.query });
    mocks.query.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("consumes the counter with one parameterized SQL statement and no session state", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ allowed: false, retry_after_seconds: 90 }] });
    expect(await takeDatabaseRateLimit(input)).toEqual({ allowed: false, retryAfterSeconds: 90 });
    expect(mocks.query).toHaveBeenCalledExactlyOnceWith(
      "select allowed, retry_after_seconds from wedding.take_rate_limit($1::text, $2::integer, $3::integer)",
      [input.keyHash, 1, 120_000]
    );
  });

  it("rejects raw identifiers, unknown fields, oversized and fractional limits without SQL", async () => {
    for (const value of [
      { ...input, keyHash: "192.0.2.1" }, { ...input, token: "private-token" },
      { ...input, maxRequests: 0 }, { ...input, maxRequests: 1001 }, { ...input, maxRequests: 1.5 },
      { ...input, windowMs: 999 }, { ...input, windowMs: 3600001 }
    ]) expect(sharedRateLimitSchema.safeParse(value).success).toBe(false);
    expect(await takeDatabaseRateLimit({ ...input, maxRequests: 0 })).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(mocks.getDatabasePool).not.toHaveBeenCalled();
  });

  it("fails closed when storage or its response contract fails", async () => {
    mocks.query.mockRejectedValueOnce(new Error("database offline"));
    expect(await takeDatabaseRateLimit(input)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    for (const rows of [[], [{ allowed: true, retry_after_seconds: 1 }], [{ allowed: false, retry_after_seconds: 0 }],
      [{ allowed: false, retry_after_seconds: 121 }], [{ allowed: "true", retry_after_seconds: 0 }]]) {
      mocks.query.mockResolvedValueOnce({ rows });
      expect(await takeDatabaseRateLimit(input)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    }
  });

  it("uses shared storage for Vercel callers and hashes the full composite key", async () => {
    vi.stubEnv("VERCEL", "1");
    mocks.query.mockResolvedValueOnce({ rows: [{ allowed: true, retry_after_seconds: 0 }] });
    expect(await takeRateLimit("entry-check-in:pass:private-token", 30)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(mocks.query.mock.calls[0][1]).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/), 30, 60_000]);
    expect(JSON.stringify(mocks.query.mock.calls)).not.toContain("private-token");
  });
});
