import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sessionStore = vi.hoisted(() => ({ manage: vi.fn() }));
vi.mock("@/lib/server/coordinator-session-store", () => ({ manageCoordinatorSession: sessionStore.manage }));

import {
  clientNetworkIdentifier,
  bearerTokenRateLimitDigest,
  COORDINATOR_SESSION_COOKIE,
  COORDINATOR_SESSION_MAX_AGE_SECONDS,
  createCoordinatorSession,
  isAuthorizedCoordinatorRequest,
  isAuthorizedCoordinatorHeaders,
  isAuthorizedCoordinatorPassword,
  isAuthorizedCoordinatorSession,
  isCoordinatorAuthConfigured,
  isCoordinatorTotpRequired,
  coordinatorTotpCounter,
  coordinatorTotpReplayIdentifier,
  isSameOriginRequest,
  invitationPublicOrigin,
  readJsonBody
} from "@/lib/server/request-security";

describe("request security helpers", () => {
  beforeEach(() => sessionStore.manage.mockReset().mockResolvedValue(true));
  afterEach(() => vi.unstubAllEnvs());

  it("requires JSON and rejects oversized bodies before parsing", async () => {
    const nonJson = await readJsonBody(new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}"
    }), 64);
    expect(nonJson).toEqual({ ok: false, reason: "unsupported_media_type" });

    const tooLarge = await readJsonBody(new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(128) })
    }), 64);
    expect(tooLarge).toEqual({ ok: false, reason: "payload_too_large" });
  });

  it("parses a bounded JSON request", async () => {
    const result = await readJsonBody(new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ answer: true })
    }), 64);
    expect(result).toEqual({ ok: true, value: { answer: true } });
  });

  it("accepts same-origin or non-browser requests and rejects cross-origin writes", () => {
    expect(isSameOriginRequest(new NextRequest("http://localhost/api", { method: "POST" }))).toBe(true);
    expect(isSameOriginRequest(new NextRequest("http://localhost/api", {
      method: "POST",
      headers: { Origin: "http://localhost" }
    }))).toBe(true);
    expect(isSameOriginRequest(new NextRequest("http://localhost/api", {
      method: "POST",
      headers: { Origin: "https://attacker.example" }
    }))).toBe(false);
  });

  it("uses the configured public origin in production instead of an internal container origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://invite.example.in");

    expect(isSameOriginRequest(new NextRequest("http://0.0.0.0:3000/api/rsvp", {
      method: "POST",
      headers: { Origin: "https://invite.example.in" }
    }))).toBe(true);
    expect(isSameOriginRequest(new NextRequest("http://0.0.0.0:3000/api/rsvp", {
      method: "POST",
      headers: { Origin: "http://0.0.0.0:3000" }
    }))).toBe(false);
    expect(isSameOriginRequest(new NextRequest("http://0.0.0.0:3000/api/rsvp", {
      method: "POST"
    }))).toBe(false);
  });

  it("builds issued invitation URLs from the configured public origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://invite.example.in");
    expect(invitationPublicOrigin(new NextRequest("http://internal-alb:3000/api/coordinator/invitations"))).toBe("https://invite.example.in");

    vi.stubEnv("PUBLIC_APP_ORIGIN", undefined);
    expect(invitationPublicOrigin(new NextRequest("http://internal-alb:3000/api/coordinator/invitations"))).toBeNull();

    vi.stubEnv("NODE_ENV", "development");
    expect(invitationPublicOrigin(new NextRequest("http://localhost:3000/api/coordinator/invitations", {
      headers: { Host: "127.0.0.1:3000" }
    }))).toBe("http://127.0.0.1:3000");
  });

  it("fails closed for missing or malformed public-origin configuration", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_APP_ORIGIN", undefined);
    expect(isSameOriginRequest(new NextRequest("http://0.0.0.0:3000/api/rsvp", {
      method: "POST",
      headers: { Origin: "https://invite.example.in" }
    }))).toBe(false);

    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://invite.example.in/not-an-origin");
    expect(isSameOriginRequest(new NextRequest("http://0.0.0.0:3000/api/rsvp", {
      method: "POST",
      headers: { Origin: "https://invite.example.in" }
    }))).toBe(false);

    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://invite.example.in/");
    expect(isSameOriginRequest(new NextRequest("http://0.0.0.0:3000/api/rsvp", {
      method: "POST",
      headers: { Origin: "https://invite.example.in" }
    }))).toBe(false);

    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("PUBLIC_APP_ORIGIN", undefined);
    expect(isSameOriginRequest(new NextRequest("http://0.0.0.0:3000/api/rsvp", {
      method: "POST",
      headers: { Origin: "https://invite.example.in" }
    }))).toBe(false);

    vi.stubEnv("NODE_ENV", undefined);
    expect(isSameOriginRequest(new NextRequest("http://0.0.0.0:3000/api/rsvp", {
      method: "POST"
    }))).toBe(false);

    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PUBLIC_APP_ORIGIN", "http://localhost:3000");
    expect(isSameOriginRequest(new NextRequest("http://localhost:3000/api/rsvp", {
      method: "POST",
      headers: { Origin: "http://localhost:3000" }
    }))).toBe(false);
  });

  it("creates and verifies a bounded signed local coordinator session", async () => {
    const password = "database-coordinator-test-password";

    vi.stubEnv("COORDINATOR_PASSWORD", undefined);
    expect(isCoordinatorAuthConfigured()).toBe(false);
    vi.stubEnv("COORDINATOR_PASSWORD", password);
    vi.stubEnv("COORDINATOR_SESSION_SECRET", "test-session-secret-abcdefghijklmnopqrstuvwxyz");
    expect(isCoordinatorAuthConfigured()).toBe(true);
    expect(isAuthorizedCoordinatorPassword(password)).toBe(true);
    expect(isAuthorizedCoordinatorPassword("incorrect-password")).toBe(false);

    const now = Date.now();
    const session = createCoordinatorSession(now);
    if (!session) throw new Error("Expected a coordinator test session.");
    const cookie = `${COORDINATOR_SESSION_COOKIE}=${session}`;
    expect(await isAuthorizedCoordinatorSession(session, now)).toBe(true);
    expect(await isAuthorizedCoordinatorHeaders(new Headers({ Cookie: cookie }))).toBe(true);
    const albCookies = Array.from({ length: 4 }, (_, index) => `shaadi_coordinator_mfa-${index}=${"x".repeat(3_000)}`).join("; ");
    expect(await isAuthorizedCoordinatorHeaders(new Headers({ Cookie: `${albCookies}; ${cookie}` }))).toBe(true);
    expect(await isAuthorizedCoordinatorHeaders(new Headers({ Cookie: `${albCookies}; ${cookie}; ${cookie}` }))).toBe(false);
    expect(await isAuthorizedCoordinatorRequest(new NextRequest("http://localhost/coordinator", {
      headers: { Cookie: cookie }
    }))).toBe(true);
    expect(await isAuthorizedCoordinatorRequest(new NextRequest("http://localhost/coordinator", {
      headers: {
        Cookie: `${COORDINATOR_SESSION_COOKIE}=${session}; ${COORDINATOR_SESSION_COOKIE}=${session}`
      }
    }))).toBe(false);
    const lastCharacter = session.at(-1);
    const tampered = `${session.slice(0, -1)}${lastCharacter === "A" ? "B" : "A"}`;
    expect(await isAuthorizedCoordinatorSession(tampered, now)).toBe(false);
    expect(await isAuthorizedCoordinatorSession(session, now + (COORDINATOR_SESSION_MAX_AGE_SECONDS + 1) * 1_000)).toBe(false);
    expect(await isAuthorizedCoordinatorHeaders(new Headers({
      Authorization: `Basic ${Buffer.from(`coordinator:${password}`).toString("base64")}`
    }))).toBe(false);

    vi.stubEnv("COORDINATOR_PASSWORD", "too-short");
    expect(isCoordinatorAuthConfigured()).toBe(false);
  });

  it("uses the raw local Host for development same-origin checks", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PUBLIC_APP_ORIGIN", undefined);

    // Next dev may normalize nextUrl to localhost even for a browser request
    // made to 127.0.0.1. The Host/Origin pair is the reliable same-origin pair.
    expect(isSameOriginRequest(new NextRequest("http://localhost:3000/api/rsvp", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:3000",
        Origin: "http://127.0.0.1:3000"
      }
    }))).toBe(true);
    expect(isSameOriginRequest(new NextRequest("http://localhost:3000/api/rsvp", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:3000",
        Origin: "http://localhost:3000"
      }
    }))).toBe(false);
    expect(isSameOriginRequest(new NextRequest("http://localhost:3000/api/rsvp", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:3000",
        Origin: "http://127.0.0.1:3001"
      }
    }))).toBe(false);
  });

  it("requires a valid authenticator secret on Vercel and invalidates sessions on its rotation", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("COORDINATOR_PASSWORD", "test-coordinator-password-123456789");
    vi.stubEnv("COORDINATOR_SESSION_SECRET", "test-session-secret-abcdefghijklmnopqrstuvwxyz");
    vi.stubEnv("COORDINATOR_TOTP_SECRET", undefined);
    expect(isCoordinatorTotpRequired()).toBe(true);
    expect(isCoordinatorAuthConfigured()).toBe(false);
    expect(createCoordinatorSession()).toBeNull();

    vi.stubEnv("COORDINATOR_TOTP_SECRET", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(isCoordinatorAuthConfigured()).toBe(true);
    expect(coordinatorTotpCounter("287082", 59_000)).toBe(1);
    expect(coordinatorTotpCounter("000000", 59_000)).toBeNull();
    const firstIdentifier = coordinatorTotpReplayIdentifier(1);
    expect(firstIdentifier).not.toContain(process.env.COORDINATOR_TOTP_SECRET);
    const session = createCoordinatorSession();
    expect(await isAuthorizedCoordinatorSession(session)).toBe(true);
    vi.stubEnv("COORDINATOR_TOTP_SECRET", "A".repeat(52));
    expect(await isAuthorizedCoordinatorSession(session)).toBe(false);
    expect(coordinatorTotpReplayIdentifier(1)).not.toBe(firstIdentifier);
    vi.stubEnv("COORDINATOR_TOTP_SECRET", "not-a-key");
    expect(isCoordinatorAuthConfigured()).toBe(false);
    expect(createCoordinatorSession()).toBeNull();
  });

  it("keeps password-only local sign-in until an authenticator key is configured", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("COORDINATOR_PASSWORD", "test-coordinator-password-123456789");
    vi.stubEnv("COORDINATOR_SESSION_SECRET", "test-session-secret-abcdefghijklmnopqrstuvwxyz");
    vi.stubEnv("COORDINATOR_TOTP_SECRET", "");
    expect(isCoordinatorTotpRequired()).toBe(false);
    expect(isCoordinatorAuthConfigured()).toBe(true);
    vi.stubEnv("COORDINATOR_TOTP_SECRET", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(isCoordinatorTotpRequired()).toBe(true);
    expect(isCoordinatorAuthConfigured()).toBe(true);
  });

  it("never enables HTTP origins on Vercel through a local-stack setting", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("LOCAL_STACK_MODE", "1");
    vi.stubEnv("PUBLIC_APP_ORIGIN", "http://127.0.0.1:3000");
    expect(isSameOriginRequest(new NextRequest("http://127.0.0.1:3000/api/rsvp", {
      method: "POST", headers: { Origin: "http://127.0.0.1:3000" }
    }))).toBe(false);
  });

  it.each([3000, 3001, 3002])("accepts HTTP for built local stack port %s only with its explicit flag", (port) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOCAL_STACK_MODE", "1");
    const origin = `http://127.0.0.1:${port}`;
    vi.stubEnv("PUBLIC_APP_ORIGIN", origin);
    const local = new NextRequest("http://internal-web:3000/api/rsvp", {
      method: "POST", headers: { Origin: origin }
    });
    expect(isSameOriginRequest(local)).toBe(true);
    expect(invitationPublicOrigin(local)).toBe(origin);

    vi.stubEnv("LOCAL_STACK_MODE", undefined);
    expect(isSameOriginRequest(local)).toBe(false);
    expect(invitationPublicOrigin(local)).toBeNull();
  });

  it.each([
    "http://127.0.0.1:3003", "http://0.0.0.0:3002", "http://localhost:3002",
    "http://127.0.0.1.evil.test:3002", "http://127.0.0.1:3002/", "http://127.0.0.1:3002?local=1"
  ])("rejects unapproved or lookalike local HTTP origins: %s", (origin) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOCAL_STACK_MODE", "1");
    vi.stubEnv("PUBLIC_APP_ORIGIN", origin);
    const request = new NextRequest("http://internal-web:3000/api/rsvp", {
      method: "POST", headers: { Origin: origin }
    });
    expect(isSameOriginRequest(request)).toBe(false);
    expect(invitationPublicOrigin(request)).toBeNull();
  });

  it("prefers a validated CloudFront viewer address and otherwise uses a bounded forwarded IP", () => {
    expect(clientNetworkIdentifier(new NextRequest("http://localhost/api", {
      headers: {
        "CloudFront-Viewer-Address": "198.51.100.10:46532",
        "X-Forwarded-For": "203.0.113.250"
      }
    }))).toBe("198.51.100.10");
    expect(clientNetworkIdentifier(new NextRequest("http://localhost/api", {
      headers: { "CloudFront-Viewer-Address": "[2001:db8::1]:443" }
    }))).toBe("2001:db8::1");
    expect(clientNetworkIdentifier(new NextRequest("http://localhost/api", {
      headers: { "X-Forwarded-For": "2001:db8::1, 10.0.0.1" }
    }))).toBe("2001:db8::1");
    expect(clientNetworkIdentifier(new NextRequest("http://localhost/api", {
      headers: { "X-Forwarded-For": "not-an-ip" }
    }))).toBe("unknown");
  });

  it("derives a stable non-secret rate-limit identifier for a bearer token", () => {
    const token = "N2p3WqBLF98cGVqHAOQm9N8w6B8LhR_Sd-CpT9kV1Ys";
    const digest = bearerTokenRateLimitDigest(token);
    expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(digest).not.toContain(token);
    expect(bearerTokenRateLimitDigest(token)).toBe(digest);
  });

  it("uses only Vercel's forwarded-IP header on Vercel, ignoring spoofable alternatives", () => {
    vi.stubEnv("VERCEL", "1");
    expect(clientNetworkIdentifier(new NextRequest("https://wedding.vercel.app/api", {
      headers: {
        "X-Vercel-Forwarded-For": "198.51.100.10",
        "CloudFront-Viewer-Address": "203.0.113.5:443",
        "X-Forwarded-For": "203.0.113.6"
      }
    }))).toBe("198.51.100.10");
    expect(clientNetworkIdentifier(new NextRequest("https://wedding.vercel.app/api", {
      headers: { "X-Forwarded-For": "203.0.113.6" }
    }))).toBe("unknown");
    expect(clientNetworkIdentifier(new NextRequest("https://wedding.vercel.app/api", {
      headers: { "X-Vercel-Forwarded-For": "not-an-ip" }
    }))).toBe("unknown");
  });
});
