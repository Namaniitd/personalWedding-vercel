import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ requestBackend: vi.fn() }));
vi.mock("@/lib/server/backend-client", () => backend);

import { resetRateLimitsForTest, takeRateLimit } from "@/lib/server/rate-limit";

describe("rate limiter", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL", "");
    resetRateLimitsForTest();
    backend.requestBackend.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("limits local callers and allows a fresh window after expiry", async () => {
    vi.useFakeTimers();
    try {
      expect((await takeRateLimit("invite:private-bearer-token", 2, 60_000)).allowed).toBe(true);
      expect((await takeRateLimit("invite:private-bearer-token", 2, 60_000)).allowed).toBe(true);
      const blocked = await takeRateLimit("invite:private-bearer-token", 2, 60_000);
      expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 60 });
      vi.advanceTimersByTime(60_000);
      expect((await takeRateLimit("invite:private-bearer-token", 2, 60_000)).allowed).toBe(true);
      expect(backend.requestBackend).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("sends only a stable hashed identifier and bounded policy to the authenticated Vercel backend", async () => {
    vi.stubEnv("VERCEL", "1");
    backend.requestBackend.mockResolvedValueOnce(Response.json({ allowed: true, retryAfterSeconds: 0 }));
    backend.requestBackend.mockResolvedValueOnce(Response.json({ allowed: false, retryAfterSeconds: 95 }));
    const identifier = "coordinator-totp:secret-counter-identifier";
    expect(await takeRateLimit(identifier, 1, 120_000)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(await takeRateLimit(identifier, 1, 120_000)).toEqual({ allowed: false, retryAfterSeconds: 95 });
    expect(backend.requestBackend.mock.calls[0]).toEqual(backend.requestBackend.mock.calls[1]);
    expect(backend.requestBackend).toHaveBeenCalledWith("/v1/security/rate-limit", {
      method: "POST", body: { keyHash: expect.stringMatching(/^[a-f0-9]{64}$/), maxRequests: 1, windowMs: 120_000 }
    });
    expect(JSON.stringify(backend.requestBackend.mock.calls)).not.toContain(identifier);
  });

  it("fails closed on unavailable storage and malformed success responses", async () => {
    vi.stubEnv("VERCEL", "1");
    const blocked = { allowed: false, retryAfterSeconds: 60 };
    backend.requestBackend.mockRejectedValueOnce(new Error("offline"));
    expect(await takeRateLimit("login:network:192.0.2.1")).toEqual(blocked);
    for (const response of [
      Response.json({ allowed: true, retryAfterSeconds: 0 }, { status: 503 }),
      Response.json({ allowed: true, retryAfterSeconds: 2 }),
      Response.json({ allowed: "true", retryAfterSeconds: 0 }),
      Response.json({ allowed: false, retryAfterSeconds: 0 }),
      Response.json({ allowed: false, retryAfterSeconds: 999999 }),
      Response.json(null),
      new Response("malformed")
    ]) {
      backend.requestBackend.mockResolvedValueOnce(response);
      expect(await takeRateLimit("login:network:192.0.2.1")).toEqual(blocked);
    }
    // An outage never creates an in-memory permit on the next function call.
    backend.requestBackend.mockRejectedValueOnce(new Error("still offline"));
    expect(await takeRateLimit("login:network:192.0.2.1")).toEqual(blocked);
  });

  it("rejects invalid policies before calling the backend", async () => {
    vi.stubEnv("VERCEL", "1");
    for (const [maxRequests, windowMs] of [[0, 60000], [1001, 60000], [2, 999], [2, 3600001], [NaN, 60000]]) {
      expect((await takeRateLimit("network:test", maxRequests, windowMs)).allowed).toBe(false);
    }
    expect(backend.requestBackend).not.toHaveBeenCalled();
  });
});
