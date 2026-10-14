import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { CoordinatorSessionRequest } from "@/lib/coordinator-session";

import { resetRateLimitsForTest } from "@/lib/server/rate-limit";
import {
  COORDINATOR_SESSION_COOKIE,
  isAuthorizedCoordinatorSession
} from "@/lib/server/request-security";

const backend = vi.hoisted(() => ({ backendCoordinatorAvailability: vi.fn(), requestBackend: vi.fn() }));
vi.mock("@/lib/server/backend-client", () => backend);
const sessionStore = vi.hoisted(() => ({ manage: vi.fn() }));
vi.mock("@/lib/server/coordinator-session-store", () => ({ manageCoordinatorSession: sessionStore.manage }));

import { GET as loginGet, POST as loginPost } from "@/app/api/coordinator/login/route";
import { POST as logoutPost } from "@/app/api/coordinator/logout/route";

const password = "test-coordinator-password-123456789";
const hostedOrigin = "https://invite.example.test";
const cognitoClientId = "1234567890abcdefghijklmnop";

function cognitoLogoutUrl(origin = hostedOrigin) {
  const url = new URL("https://wedding-test.auth.ap-northeast-1.amazoncognito.com/logout");
  url.searchParams.set("client_id", cognitoClientId);
  url.searchParams.set("logout_uri", `${origin}/`);
  return url.href;
}

function loginRequest(candidate: unknown, headers: Record<string, string> = {}, origin = "http://localhost") {
  return new NextRequest(`${origin}/api/coordinator/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, "X-Forwarded-For": "203.0.113.30", ...headers },
    body: JSON.stringify(candidate)
  });
}

function sessionFrom(response: Response) {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const value = new RegExp(`${COORDINATOR_SESSION_COOKIE}=([^;]+)`).exec(setCookie)?.[1];
  if (!value) throw new Error("Expected a signed session cookie.");
  return value;
}

describe("coordinator sign in boundary", () => {
  beforeEach(() => {
    const sessions = new Set<string>();
    sessionStore.manage.mockReset().mockImplementation(async (input: CoordinatorSessionRequest) => {
      if (input.action === "register") { sessions.add(input.sessionHash); return true; }
      if (input.action === "revoke") { sessions.delete(input.sessionHash); return true; }
      return sessions.has(input.sessionHash);
    });
    resetRateLimitsForTest();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("COORDINATOR_TOTP_SECRET", undefined);
    vi.stubEnv("PUBLIC_APP_ORIGIN", undefined);
    vi.stubEnv("COORDINATOR_COGNITO_LOGOUT_URL", undefined);
    vi.stubEnv("COORDINATOR_PASSWORD", password);
    vi.stubEnv("COORDINATOR_SESSION_SECRET", "test-session-secret-abcdefghijklmnopqrstuvwxyz");
    backend.backendCoordinatorAvailability.mockReset().mockResolvedValue("available");
    backend.requestBackend.mockReset().mockImplementation(async () => Response.json({ allowed: true, retryAfterSeconds: 0 }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("sets an HttpOnly signed cookie without returning the password", async () => {
    const response = await loginPost(loginRequest({ password }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")?.toLowerCase()).toContain("samesite=strict");
    expect(response.headers.get("set-cookie")).not.toContain(password);
    expect(await isAuthorizedCoordinatorSession(sessionFrom(response))).toBe(true);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects wrong passwords, cross-origin writes, and malformed JSON", async () => {
    const wrong = await loginPost(loginRequest({ password: "wrong-password" }));
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("set-cookie")).toBeNull();
    expect((await loginPost(loginRequest({ password }, { Origin: "https://attacker.example" }))).status).toBe(403);
    expect((await loginPost(loginRequest({ password, extra: true }))).status).toBe(400);
    expect((await loginPost(loginRequest({ password }, { "Content-Type": "text/plain" }))).status).toBe(415);
  });

  it("requires configured MFA and a valid password plus authenticator code on Vercel", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(59_000);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("PUBLIC_APP_ORIGIN", hostedOrigin);
    expect((await loginPost(loginRequest({ password }, {}, hostedOrigin))).status).toBe(503);
    vi.stubEnv("COORDINATOR_TOTP_SECRET", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    for (const credentials of [
      { password },
      { password, code: "000000" },
      { password: "wrong-password", code: "287082" }
    ]) {
      const response = await loginPost(loginRequest(credentials, {}, hostedOrigin));
      expect(response.status).toBe(401);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    const response = await loginPost(loginRequest({ password, code: "287082" }, {}, hostedOrigin));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(await isAuthorizedCoordinatorSession(sessionFrom(response))).toBe(true);
    const payload = await response.text();
    expect(payload).not.toContain(password);
    expect(payload).not.toContain("287082");
    expect(payload).not.toContain(process.env.COORDINATOR_TOTP_SECRET);
    expect(backend.requestBackend).toHaveBeenLastCalledWith("/v1/security/rate-limit", {
      method: "POST", body: { keyHash: expect.stringMatching(/^[a-f0-9]{64}$/), maxRequests: 1, windowMs: 120_000 }
    });
  });

  it("consumes an authenticator code once through the shared backend store", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(59_000);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("PUBLIC_APP_ORIGIN", hostedOrigin);
    vi.stubEnv("COORDINATOR_TOTP_SECRET", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    const consumedKeys = new Set<string>();
    backend.requestBackend.mockImplementation(async (_path, options) => {
      const { keyHash, maxRequests } = options.body;
      const allowed = maxRequests !== 1 || !consumedKeys.has(keyHash);
      if (maxRequests === 1) consumedKeys.add(keyHash);
      return Response.json({ allowed, retryAfterSeconds: allowed ? 0 : 120 });
    });
    expect((await loginPost(loginRequest({ password, code: "287082" }, {}, hostedOrigin))).status).toBe(200);
    const replay = await loginPost(loginRequest({ password, code: "287082" }, {
      "X-Forwarded-For": "203.0.113.99"
    }, hostedOrigin));
    expect(replay.status).toBe(401);
    expect(replay.headers.get("set-cookie")).toBeNull();
    expect((await replay.json()).error).toContain("already been used");
  });

  it("clears only a signed same-origin session", async () => {
    const signed = sessionFrom(await loginPost(loginRequest({ password })));
    const logout = (cookie: string, origin = "http://localhost") => new NextRequest(`${origin}/api/coordinator/logout`, {
      method: "POST", headers: { Origin: origin, Cookie: `${COORDINATOR_SESSION_COOKIE}=${cookie}` }
    });
    const response = await logoutPost(logout(signed));
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(await isAuthorizedCoordinatorSession(signed)).toBe(false);
    expect((await logoutPost(logout("invalid"))).status).toBe(403);
    expect((await logoutPost(new NextRequest("http://localhost/api/coordinator/logout", {
      method: "POST", headers: { Origin: "https://attacker.example", Cookie: `${COORDINATOR_SESSION_COOKIE}=${signed}` }
    }))).status).toBe(403);
  });

  it("clears app and sharded ALB cookies before returning a validated Cognito logout URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_APP_ORIGIN", hostedOrigin);
    const logoutUrl = cognitoLogoutUrl();
    vi.stubEnv("COORDINATOR_COGNITO_LOGOUT_URL", logoutUrl);
    const signed = sessionFrom(await loginPost(loginRequest({ password }, {}, hostedOrigin)));
    const albCookies = Array.from({ length: 4 }, (_, index) => `shaadi_coordinator_mfa-${index}=${"x".repeat(3_000)}`).join("; ");

    const response = await logoutPost(new NextRequest(`${hostedOrigin}/api/coordinator/logout`, {
      method: "POST",
      headers: { Origin: hostedOrigin, Cookie: `${albCookies}; ${COORDINATOR_SESSION_COOKIE}=${signed}` }
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({ logoutUrl });
    const cookies = response.headers.getSetCookie();
    expect(cookies.map((cookie) => cookie.split("=")[0])).toEqual([
      COORDINATOR_SESSION_COOKIE,
      "shaadi_coordinator_mfa",
      "shaadi_coordinator_mfa-0",
      "shaadi_coordinator_mfa-1",
      "shaadi_coordinator_mfa-2",
      "shaadi_coordinator_mfa-3"
    ]);
    for (const cookie of cookies) {
      expect(cookie).toContain("Max-Age=0");
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("Secure");
    }
  });

  it("falls back to local sign-out when a configured logout destination is malformed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_APP_ORIGIN", hostedOrigin);
    const valid = new URL(cognitoLogoutUrl());
    const malformed = [
      valid.href.replace("https://", "http://"),
      valid.href.replace("amazoncognito.com", "amazoncognito.com.evil.test"),
      valid.href.replace("/logout?", "/login?"),
      cognitoLogoutUrl("https://elsewhere.example.test"),
      `${valid.href}&client_id=${cognitoClientId}`,
      `${valid.href}&redirect_uri=https%3A%2F%2Fevil.test%2F`,
      valid.href.replace(cognitoClientId, "not-a-cognito-client-id")
    ];

    for (const destination of malformed) {
      const signed = sessionFrom(await loginPost(loginRequest({ password }, {}, hostedOrigin)));
      vi.stubEnv("COORDINATOR_COGNITO_LOGOUT_URL", destination);
      const response = await logoutPost(new NextRequest(`${hostedOrigin}/api/coordinator/logout`, {
        method: "POST",
        headers: { Origin: hostedOrigin, Cookie: `${COORDINATOR_SESSION_COOKIE}=${signed}` }
      }));
      expect(response.status).toBe(204);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.getSetCookie()).toHaveLength(6);
    }
  });

  it("distinguishes a private API outage from disabled coordinator mode", async () => {
    backend.backendCoordinatorAvailability.mockResolvedValueOnce("unavailable");
    expect((await loginPost(loginRequest({ password }))).status).toBe(503);
    backend.backendCoordinatorAvailability.mockResolvedValueOnce("disabled");
    expect((await loginGet(new NextRequest("http://localhost/api/coordinator/login"))).status).toBe(503);
  });

  it("does not issue a cookie when durable session registration fails", async () => {
    sessionStore.manage.mockResolvedValueOnce(false);
    const response = await loginPost(loginRequest({ password }));
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not report successful logout when revocation cannot be persisted", async () => {
    const signed = sessionFrom(await loginPost(loginRequest({ password })));
    sessionStore.manage.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const response = await logoutPost(new NextRequest("http://localhost/api/coordinator/logout", {
      method: "POST", headers: { Origin: "http://localhost", Cookie: `${COORDINATOR_SESSION_COOKIE}=${signed}` }
    }));
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await isAuthorizedCoordinatorSession(signed)).toBe(true);
  });

  it.each([3000, 3001, 3002])("uses HTTP cookies only under the explicit local-stack origin on port %s", async (port) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOCAL_STACK_MODE", "1");
    const origin = `http://127.0.0.1:${port}`;
    vi.stubEnv("PUBLIC_APP_ORIGIN", origin);
    const local = await loginPost(loginRequest({ password }, {}, origin));
    expect(local.status).toBe(200);
    expect(local.headers.get("set-cookie")).not.toContain("Secure");

    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://invite.example.test");
    const hosted = await loginPost(loginRequest({ password }, {}, "https://invite.example.test"));
    expect(hosted.status).toBe(200);
    expect(hosted.headers.get("set-cookie")).toContain("Secure");
  });
});
