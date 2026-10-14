import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { manageCoordinatorSession } from "./coordinator-session-store";

const backend = vi.hoisted(() => ({ requestBackend: vi.fn() }));
vi.mock("@/lib/server/backend-client", () => backend);

describe("shared coordinator session store", () => {
  beforeEach(() => backend.requestBackend.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("checks every request rather than reusing a positive authorization", async () => {
    backend.requestBackend.mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ ok: false }));
    const input = { action: "validate" as const, sessionHash: "a".repeat(64) };
    expect(await manageCoordinatorSession(input)).toBe(true);
    expect(await manageCoordinatorSession(input)).toBe(false);
    expect(backend.requestBackend).toHaveBeenCalledTimes(2);
    expect(backend.requestBackend).toHaveBeenCalledWith("/v1/security/coordinator-session", { method: "POST", body: input });
  });

  it.each([{}, { ok: "true" }, { ok: 1 }, [], null])("fails closed for a malformed API result", async (result) => {
    backend.requestBackend.mockResolvedValueOnce(Response.json(result));
    expect(await manageCoordinatorSession({ action: "validate", sessionHash: "a".repeat(64) })).toBe(false);
  });

  it("fails closed for service outages and missing migrations", async () => {
    backend.requestBackend.mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status: 503 }));
    const input = { action: "revoke" as const, sessionHash: "a".repeat(64) };
    expect(await manageCoordinatorSession(input)).toBe(false);
    expect(await manageCoordinatorSession(input)).toBe(false);
  });
});
