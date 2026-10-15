import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { resetRateLimitsForTest } from "@/lib/server/rate-limit";
import { COORDINATOR_SESSION_COOKIE, createCoordinatorSession } from "@/lib/server/request-security";

const backend = vi.hoisted(() => ({
  backendCoordinatorAvailability: vi.fn(),
  requestBackend: vi.fn(),
  forwardBackendJson: vi.fn()
}));
vi.mock("@/lib/server/backend-client", () => backend);
const sessionStore = vi.hoisted(() => ({ manage: vi.fn() }));
vi.mock("@/lib/server/coordinator-session-store", () => ({ manageCoordinatorSession: sessionStore.manage }));

import { POST as checkIn } from "@/app/api/coordinator/check-in/route";
import { GET as getContent, PUT as putContent } from "@/app/api/coordinator/content/route";
import { GET as getInvitations, POST as issueInvitation } from "@/app/api/coordinator/invitations/route";
import { POST as revokeInvitation } from "@/app/api/coordinator/invitations/revoke/route";
import { POST as deleteRsvp } from "@/app/api/coordinator/invitations/rsvp/delete/route";
import { POST as recordRsvp } from "@/app/api/coordinator/rsvp/route";

const issuedToken = "A".repeat(43);
const issued = {
  id: "3810429c-b718-4ff8-b9bd-b6df41d85f1b",
  token: issuedToken,
  createdAt: "2099-01-01T00:00:00.000Z",
  householdName: { en: "Test household", hi: "Test household" },
  eventCount: 1,
  contactRole: "groom"
};

function sessionCookie() {
  const session = createCoordinatorSession();
  if (!session) throw new Error("Expected a signed test session.");
  return `${COORDINATOR_SESSION_COOKIE}=${session}`;
}

function mutation(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
      Cookie: sessionCookie(),
      "X-Forwarded-For": "203.0.113.20",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

describe("coordinator browser API boundary", () => {
  beforeEach(() => {
    sessionStore.manage.mockReset().mockResolvedValue(true);
    resetRateLimitsForTest();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PUBLIC_APP_ORIGIN", undefined);
    vi.stubEnv("COORDINATOR_PASSWORD", "test-coordinator-password-123456789");
    vi.stubEnv("COORDINATOR_SESSION_SECRET", "test-session-secret-abcdefghijklmnopqrstuvwxyz");
    backend.backendCoordinatorAvailability.mockReset().mockResolvedValue("available");
    backend.requestBackend.mockReset().mockResolvedValue(Response.json({ ok: true }));
    backend.forwardBackendJson.mockReset().mockImplementation(async (response: Response) => ({
      payload: await response.json(), status: response.status, headers: undefined
    }));
  });

  afterEach(() => vi.unstubAllEnvs());

  it("blocks revoked or unregistered cookies in every coordinator handler", async () => {
    sessionStore.manage.mockResolvedValue(false);
    const input = { invitationId: issued.id };
    for (const handler of [revokeInvitation, deleteRsvp, checkIn, issueInvitation, recordRsvp]) {
      expect((await handler(mutation("/api/coordinator/action", input))).status).toBe(403);
    }
    expect((await getContent(mutation("/api/coordinator/content", input))).status).toBe(403);
    expect((await putContent(mutation("/api/coordinator/content", input))).status).toBe(403);
    expect(backend.requestBackend).not.toHaveBeenCalled();
  });

  it("constructs the one-response public URL from a validated backend credential", async () => {
    backend.requestBackend.mockResolvedValueOnce(Response.json({ ok: true, issued }));
    const input = {
      householdNameEn: "Test household", householdNameHi: "", preferredLocale: "en",
      eventLimits: [{ eventId: "event-one", adults: 2, children: 0 }]
    };
    const response = await issueInvitation(mutation("/api/coordinator/invitations", input));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const payload = await response.json();
    expect(payload).toEqual({
      ok: true,
      invitationId: issued.id,
      createdAt: issued.createdAt,
      invitationUrl: `http://localhost/i/g/${issuedToken}`,
      householdName: issued.householdName,
      eventCount: 1,
      contactRole: "groom"
    });
    expect(payload.token).toBeUndefined();
    expect(backend.requestBackend).toHaveBeenCalledWith("/v1/coordinator/invitations", { method: "POST", body: input, side: "groom" });
  });

  it("requires a signed same-origin browser request before forwarding a coordinator mutation", async () => {
    const input = { invitationId: issued.id };
    expect((await revokeInvitation(mutation("/api/coordinator/invitations/revoke", input, { Origin: "https://attacker.example" }))).status).toBe(403);
    expect((await revokeInvitation(mutation("/api/coordinator/invitations/revoke", input, { Cookie: "" }))).status).toBe(403);
    expect((await revokeInvitation(mutation("/api/coordinator/invitations/revoke", input, { "Content-Type": "text/plain" }))).status).toBe(415);
    expect(backend.requestBackend).not.toHaveBeenCalled();
  });

  it("binds bride requests to the URL and issues a bride link only for a matching backend owner", async () => {
    vi.stubEnv("COORDINATOR_BRIDE_PASSWORD", "independent-bride-password-123456789");
    const session = createCoordinatorSession(Date.now(), "bride");
    const headers = { Cookie: `${COORDINATOR_SESSION_COOKIE}=${session}`, "X-Wedding-Side": "groom" };
    backend.requestBackend.mockResolvedValueOnce(Response.json({ ok: true, issued: { ...issued, side: "bride", contactRole: "bride" } }));
    const response = await issueInvitation(mutation("/api/coordinator/b/invitations", {}, headers));
    expect(response.status).toBe(200);
    expect((await response.json()).invitationUrl).toBe(`http://localhost/i/b/${issuedToken}`);
    expect(backend.requestBackend).toHaveBeenLastCalledWith("/v1/coordinator/invitations", { side: "bride", method: "POST", body: {} });
    backend.requestBackend.mockResolvedValueOnce(Response.json({ ok: true, issued }));
    expect((await issueInvitation(mutation("/api/coordinator/b/invitations", {}, headers))).status).toBe(503);
    expect((await issueInvitation(mutation("/api/coordinator/g/invitations", {}, headers))).status).toBe(403);
  });

  it("preserves revoke, RSVP deletion, and content conflict results", async () => {
    backend.requestBackend.mockResolvedValueOnce(Response.json({ ok: true, invitationId: issued.id, revokedAt: issued.createdAt }));
    expect((await revokeInvitation(mutation("/api/coordinator/invitations/revoke", { invitationId: issued.id }))).status).toBe(200);

    backend.requestBackend.mockResolvedValueOnce(Response.json({ error: "Disable this invitation before deleting its RSVP." }, { status: 409 }));
    const deletion = await deleteRsvp(mutation("/api/coordinator/invitations/rsvp/delete", { invitationId: issued.id }));
    expect(deletion.status).toBe(409);

    backend.requestBackend.mockResolvedValueOnce(Response.json({ error: "Wedding content changed in another session." }, { status: 409 }));
    const content = await putContent(mutation("/api/coordinator/content", { revision: "old" }));
    expect(content.status).toBe(409);
    expect(backend.requestBackend).toHaveBeenLastCalledWith("/v1/coordinator/content", {
      method: "PUT", body: { revision: "old" }, side: "groom"
    });
  });

  it("forwards coordinator reads and valid scans without exposing the pass token in results", async () => {
    backend.requestBackend.mockResolvedValueOnce(Response.json({ ok: true, configuration: { revision: null } }));
    const content = await getContent(new NextRequest("http://localhost/api/coordinator/content", {
      headers: { Cookie: sessionCookie() }
    }));
    expect(content.status).toBe(200);
    expect(backend.requestBackend).toHaveBeenCalledWith("/v1/coordinator/content", { side: "groom" });

    const passToken = "B".repeat(43);
    backend.requestBackend.mockResolvedValueOnce(Response.json({ ok: true, outcome: "checked_in", householdName: "Test household" }));
    const scanned = await checkIn(mutation("/api/coordinator/check-in", { passToken, eventId: "event-one" }));
    expect(scanned.status).toBe(200);
    expect(JSON.stringify(await scanned.json())).not.toContain(passToken);
    expect(backend.requestBackend).toHaveBeenLastCalledWith("/v1/coordinator/check-in", {
      method: "POST", body: { passToken, eventId: "event-one" }, side: "groom"
    });
  });

  it("reports a private API outage as 503 and an explicitly disabled coordinator as 404", async () => {
    backend.backendCoordinatorAvailability.mockResolvedValueOnce("unavailable");
    expect((await issueInvitation(mutation("/api/coordinator/invitations", {}))).status).toBe(503);
    backend.backendCoordinatorAvailability.mockResolvedValueOnce("disabled");
    expect((await issueInvitation(mutation("/api/coordinator/invitations", {}))).status).toBe(404);
    expect(backend.requestBackend).not.toHaveBeenCalled();

    const method = await getInvitations(new NextRequest("http://localhost/api/coordinator/invitations"));
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("POST");
  });

  const manualReply = {
    invitationId: issued.id, respondentName: "Guest One", status: "attending",
    attendances: [{ eventId: "event-one", attending: true, adults: 2, children: 0 }],
    comfortNote: "Step-free access", expectedUpdatedAt: null
  };

  it("requires a signed same-origin JSON request for a manual RSVP", async () => {
    const path = "/api/coordinator/rsvp";
    expect((await recordRsvp(mutation(path, manualReply, { Cookie: "" }))).status).toBe(403);
    expect((await recordRsvp(mutation(path, manualReply, { Origin: "https://attacker.example" }))).status).toBe(403);
    expect((await recordRsvp(mutation(path, manualReply, { Origin: "" }))).status).toBe(403);
    expect((await recordRsvp(mutation(path, manualReply, { "Content-Type": "text/plain" }))).status).toBe(415);
    expect((await recordRsvp(mutation(path, manualReply, { "Content-Length": "20000" }))).status).toBe(413);
    expect(backend.requestBackend).not.toHaveBeenCalled();
  });

  it("rejects missing concurrency state, duplicates, unknown fields and invalid IDs before forwarding", async () => {
    const path = "/api/coordinator/rsvp";
    for (const input of [
      { ...manualReply, expectedUpdatedAt: undefined }, { ...manualReply, invitationId: "not-an-id" },
      { ...manualReply, token: issuedToken }, { ...manualReply, attendances: [manualReply.attendances[0], manualReply.attendances[0]] }
    ]) expect((await recordRsvp(mutation(path, input))).status).toBe(400);
    expect(backend.requestBackend).not.toHaveBeenCalled();
  });

  it("forwards a manual reply and returns only its confirmed update timestamp", async () => {
    backend.requestBackend.mockResolvedValueOnce(Response.json({ ok: true, updatedAt: issued.createdAt }));
    const response = await recordRsvp(mutation("/api/coordinator/rsvp", manualReply));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, updatedAt: issued.createdAt });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(backend.requestBackend).toHaveBeenLastCalledWith("/v1/coordinator/rsvp", { method: "POST", body: manualReply, side: "groom" });
    backend.requestBackend.mockResolvedValueOnce(Response.json({ ok: true, updatedAt: issued.createdAt, token: issuedToken }));
    expect((await recordRsvp(mutation("/api/coordinator/rsvp", manualReply))).status).toBe(503);
  });

  it("preserves a concurrent guest edit and an inactive invitation result", async () => {
    backend.requestBackend.mockResolvedValueOnce(Response.json({ error: "This RSVP changed. Reload before editing." }, { status: 409 }));
    const conflict = await recordRsvp(mutation("/api/coordinator/rsvp", manualReply));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "This RSVP changed. Reload before editing." });
    backend.requestBackend.mockResolvedValueOnce(Response.json({ error: "Invitation unavailable." }, { status: 404 }));
    expect((await recordRsvp(mutation("/api/coordinator/rsvp", manualReply))).status).toBe(404);
  });
});
