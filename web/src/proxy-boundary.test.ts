import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";

import { config, proxy } from "@/proxy";
import { COORDINATOR_SESSION_COOKIE, createCoordinatorSession } from "@/lib/server/request-security";

const backend = vi.hoisted(() => ({ getBackendStatus: vi.fn() }));
vi.mock("@/lib/server/backend-client", () => backend);
const sessionStore = vi.hoisted(() => ({ manage: vi.fn() }));
vi.mock("@/lib/server/coordinator-session-store", () => ({ manageCoordinatorSession: sessionStore.manage }));

describe("private page proxy", () => {
  beforeEach(() => {
    sessionStore.manage.mockReset().mockResolvedValue(true);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("COORDINATOR_PASSWORD", "test-coordinator-password-123456789");
    vi.stubEnv("COORDINATOR_SESSION_SECRET", "test-session-secret-abcdefghijklmnopqrstuvwxyz");
    backend.getBackendStatus.mockReset().mockResolvedValue({ mode: "database", coordinatorAvailable: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a copied revoked cookie for both pages and API prefetches", async () => {
    const session = createCoordinatorSession();
    sessionStore.manage.mockResolvedValue(false);
    const headers = { Cookie: `${COORDINATOR_SESSION_COOKIE}=${session}`, "next-router-prefetch": "1", purpose: "prefetch" };
    expect((await proxy(new NextRequest("http://localhost/coordinator", { headers }))).status).toBe(307);
    expect((await proxy(new NextRequest("http://localhost/api/coordinator/content", { headers }))).status).toBe(401);
  });

  it("always matches private invitation and coordinator prefetches", () => {
    for (const url of ["/i/test-invitation-token", "/coordinator", "/api/coordinator/invitations"]) {
      expect(unstable_doesMiddlewareMatch({
        config, url, headers: { "next-router-prefetch": "1", purpose: "prefetch" }
      })).toBe(true);
    }
  });

  it("redirects unsigned coordinator pages and rejects unsigned coordinator APIs", async () => {
    const page = await proxy(new NextRequest("http://localhost/coordinator"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost/coordinator/login");
    expect(page.headers.get("content-security-policy")).toContain("nonce-");
    const api = await proxy(new NextRequest("http://localhost/api/coordinator/invitations"));
    expect(api.status).toBe(401);
    expect(api.headers.get("www-authenticate")).toBeNull();
  });

  it("allows a valid signed session and does not expose disabled coordinator APIs", async () => {
    const session = createCoordinatorSession();
    if (!session) throw new Error("Expected a signed test session.");
    const request = new NextRequest("http://localhost/coordinator", {
      headers: { Cookie: `${COORDINATOR_SESSION_COOKIE}=${session}` }
    });
    expect((await proxy(request)).status).toBe(200);
    backend.getBackendStatus.mockResolvedValueOnce({ mode: "hosted", coordinatorAvailable: false });
    expect((await proxy(new NextRequest("http://localhost/api/coordinator/content", {
      headers: { Cookie: `${COORDINATOR_SESSION_COOKIE}=${session}` }
    }))).status).toBe(404);
  });

  it("returns 503 for a private invitation when the backend cannot be reached", async () => {
    backend.getBackendStatus.mockRejectedValueOnce(new Error("down"));
    const response = await proxy(new NextRequest("http://localhost/i/test-invitation-token", {
      headers: { "next-router-prefetch": "1", purpose: "prefetch" }
    }));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-security-policy")).toContain("nonce-");
  });

  it.each([3000, 3001, 3002])("does not upgrade requests in the explicit local HTTP stack on port %s", async (port) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOCAL_STACK_MODE", "1");
    const origin = `http://127.0.0.1:${port}`;
    vi.stubEnv("PUBLIC_APP_ORIGIN", origin);
    const response = await proxy(new NextRequest(`${origin}/`));
    expect(response.headers.get("content-security-policy")).not.toContain("upgrade-insecure-requests");
  });
});
