import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BackendUnavailableError,
  getBackendCoordinatorWorkspace,
  requestBackend,
  resolveBackendInvitation,
  resolvePublicInvitation
} from "./backend-client";

const token = "frontend-test-service-token-abcdefghijklmnopqrstuvwxyz";

describe("frontend private API client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("LOCAL_STACK_MODE", undefined);
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://invite.example.test");
    vi.stubEnv("BACKEND_URL", "http://127.0.0.1:4000");
    vi.stubEnv("BACKEND_SERVICE_TOKEN", token);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("accepts a public template only when its side and privacy boundary match", async () => {
    const resolved = { invitation: { kind: "public", side: "bride", token: "public-invitation-bride" }, events: [], wedding: {}, rsvp: null };
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, resolved }));
    await expect(resolvePublicInvitation("bride")).resolves.toEqual(resolved);
    expect((fetchMock.mock.calls[0]?.[0] as URL).pathname).toBe("/v1/public/invitations/resolve");
    for (const invalid of [
      { ...resolved, rsvp: { respondentName: "Private guest" } },
      { ...resolved, entryPass: { qrPayload: "private" } },
      { ...resolved, invitation: { ...resolved.invitation, side: "groom" } },
      { ...resolved, invitation: { ...resolved.invitation, kind: "private" } }
    ]) {
      fetchMock.mockResolvedValueOnce(Response.json({ ok: true, resolved: invalid }));
      await expect(resolvePublicInvitation("bride")).rejects.toBeInstanceOf(BackendUnavailableError);
    }
  });

  it("refuses an external backend URL before sending the service token", async () => {
    vi.stubEnv("BACKEND_URL", "https://external.example.test");
    await expect(requestBackend("/v1/status")).rejects.toBeInstanceOf(BackendUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the credential only to task loopback and rejects redirects", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ mode: "database", coordinatorAvailable: true }));
    await requestBackend("/v1/status");
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://127.0.0.1:4000/v1/status");
    expect(new Headers(init.headers).get("x-backend-service-token")).toBe(token);
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
  });

  it("pins authenticated Vercel requests to the configured HTTPS project origin", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("BACKEND_URL", "https://wedding-api.vercel.app");
    fetchMock.mockResolvedValueOnce(Response.json({ mode: "database", coordinatorAvailable: true }));
    await requestBackend("/v1/status");
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://wedding-api.vercel.app/v1/status");
    expect(new Headers(init.headers).get("x-backend-service-token")).toBe(token);
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    undefined,
    "http://127.0.0.1:4000",
    "http://api:4000",
    "http://wedding-api.vercel.app",
    "https://evil.test",
    "https://wedding-api.vercel.app.evil.test",
    "https://wedding-api.evil.vercel.app",
    "https://wedding-api.vercel.app/",
    "https://wedding-api.vercel.app/api",
    "https://wedding-api.vercel.app?target=1",
    "https://wedding-api.vercel.app#target",
    "https://operator:secret@wedding-api.vercel.app",
    "https://wedding-api.vercel.app:8443",
    " https://wedding-api.vercel.app",
    "https://WEDDING-API.vercel.app"
  ])("refuses invalid Vercel backend setting %s before sending a secret", async (origin) => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("BACKEND_URL", origin);
    await expect(requestBackend("/v1/status")).rejects.toBeInstanceOf(BackendUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns a private service-token mismatch into an availability failure", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Unauthorized." }, { status: 401 }));
    await expect(requestBackend("/v1/rsvp", { method: "POST", body: {} }))
      .rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it.each([3000, 3001, 3002])("allows only the fixed Compose service in local-stack mode on port %s", async (port) => {
    vi.stubEnv("LOCAL_STACK_MODE", "1");
    vi.stubEnv("PUBLIC_APP_ORIGIN", `http://127.0.0.1:${port}`);
    vi.stubEnv("BACKEND_URL", "http://api:4000");
    fetchMock.mockResolvedValueOnce(Response.json({ mode: "database", coordinatorAvailable: true }));
    await requestBackend("/v1/status");
    expect((fetchMock.mock.calls[0]?.[0] as URL).origin).toBe("http://api:4000");

    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://invite.example.test");
    await expect(requestBackend("/v1/status")).rejects.toBeInstanceOf(BackendUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves only matching invitation DTOs and treats 404 as an inactive link", async () => {
    const invitationToken = "invitation-token-abcdefghijklmnopqrstuvwxyz";
    fetchMock.mockResolvedValueOnce(Response.json({ error: "inactive" }, { status: 404 }));
    await expect(resolveBackendInvitation(invitationToken)).resolves.toBeNull();

    fetchMock.mockResolvedValueOnce(Response.json({
      ok: true,
      resolved: { invitation: { token: "different-token" }, events: [], wedding: {} }
    }));
    await expect(resolveBackendInvitation(invitationToken)).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it("rejects malformed coordinator DTOs instead of rendering private pages", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, issuerOptions: {}, invitations: "not-an-array" }));
    await expect(getBackendCoordinatorWorkspace()).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it("accepts a coordinator workspace before wedding content or invitations exist", async () => {
    const workspace = {
      issuerOptions: {
        events: [],
        defaultEventLimits: [],
        contactOptions: [],
        defaultContactRole: "groom"
      },
      invitations: []
    };
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, ...workspace }));

    await expect(getBackendCoordinatorWorkspace()).resolves.toEqual(workspace);
  });

  it("rejects a coordinator workspace when the private API returns HTTP 503", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Service unavailable." }, { status: 503 }));

    await expect(getBackendCoordinatorWorkspace()).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it("rejects a coordinator workspace when the private API cannot be reached", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(getBackendCoordinatorWorkspace()).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it("fails closed for bride requests on an older API and supplies trusted scope on an upgraded API", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ mode: "database", coordinatorAvailable: true }));
    await expect(requestBackend("/v1/coordinator/content", { side: "bride" })).rejects.toBeInstanceOf(BackendUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(Response.json({ mode: "database", coordinatorAvailable: true, sideIsolation: true }));
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));
    await requestBackend("/v1/coordinator/content", { side: "bride" });
    const [, init] = fetchMock.mock.calls[2] as [URL, RequestInit];
    expect(new Headers(init.headers).get("x-wedding-side")).toBe("bride");
  });

  it("checks the invitation owner even when an old backend ignores the expected side", async () => {
    const invitationToken = "invitation-token-abcdefghijklmnopqrstuvwxyz";
    fetchMock.mockResolvedValueOnce(Response.json({
      ok: true, resolved: { invitation: { token: invitationToken }, events: [], wedding: {} }
    }));
    await expect(resolveBackendInvitation(invitationToken, "bride")).resolves.toBeNull();
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ token: invitationToken, side: "bride" });
  });
});
