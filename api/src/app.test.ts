import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mode: vi.fn(),
  resolveInvitation: vi.fn(),
  saveDatabaseRSVP: vi.fn(),
  saveCoordinatorRSVP: vi.fn(),
  getDatabasePool: vi.fn(),
  getIssuerOptions: vi.fn(),
  listInvitations: vi.fn(),
  loadContent: vi.fn(),
  validateIssue: vi.fn(),
  validateContact: vi.fn(),
  issueInvitation: vi.fn(),
  manageSession: vi.fn()
}));

vi.mock("./lib/invitation-mode", () => ({ getInvitationStoreMode: mocks.mode }));
vi.mock("./lib/database-coordinator-sessions", () => ({ manageDatabaseCoordinatorSession: mocks.manageSession }));
vi.mock("./lib/invitations", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lib/invitations")>(),
  resolveInvitation: mocks.resolveInvitation
}));
vi.mock("./lib/database-rsvps", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lib/database-rsvps")>(),
  getDatabasePool: mocks.getDatabasePool,
  saveDatabaseRSVP: mocks.saveDatabaseRSVP
}));
vi.mock("./lib/database-coordinator-rsvps", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lib/database-coordinator-rsvps")>(),
  saveDatabaseCoordinatorRSVP: mocks.saveCoordinatorRSVP
}));
vi.mock("./lib/database-invitations", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lib/database-invitations")>(),
  getDatabaseInvitationIssuerOptions: mocks.getIssuerOptions,
  listDatabaseCoordinatorInvitations: mocks.listInvitations,
  validateDatabaseInvitationIssue: mocks.validateIssue,
  validateDatabaseInvitationContactRole: mocks.validateContact,
  issueDatabaseInvitation: mocks.issueInvitation
}));
vi.mock("./lib/database-wedding-content-editor", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lib/database-wedding-content-editor")>(),
  loadDatabaseWeddingContentEditor: mocks.loadContent
}));

import { handleApiRequest } from "./app";

const serviceToken = "api-test-service-token-abcdefghijklmnopqrstuvwxyz";
const invitationToken = "guest-invitation-token-abcdefghijklmnopqrstuvwxyz";
const resolvedInvitation = {
  invitation: {
    token: invitationToken,
    householdName: { en: "Test household", hi: "परीक्षण परिवार" },
    preferredLocale: "en",
    eventIds: ["event-one"],
    eventLimits: { "event-one": { adults: 2, children: 1 } },
    rsvpDeadline: { en: "31 December 2099", hi: "31 दिसंबर 2099" },
    rsvpDeadlineIso: "2099-12-31T23:59:59.000Z",
    coordinator: {
      role: "groom", name: "Desk", phoneDisplay: "+91 98765 43210",
      phoneHref: "tel:+919876543210", whatsappHref: "https://wa.me/919876543210"
    }
  },
  events: [{
    id: "event-one", title: { en: "Celebration", hi: "समारोह" },
    date: { en: "Tomorrow", hi: "कल" }, startTime: { en: "7 PM", hi: "शाम 7 बजे" },
    arrivalWindow: { en: "7 PM", hi: "शाम 7 बजे" },
    startIso: "2099-12-30T19:00:00.000Z", endIso: "2099-12-30T22:00:00.000Z",
    venue: { en: "Venue", hi: "स्थल" }, address: { en: "Address", hi: "पता" },
    mapsUrl: "https://maps.example.test", entryNote: { en: "Entry", hi: "प्रवेश" },
    dressCode: { en: "Festive", hi: "उत्सव" }, practicalNote: { en: "Note", hi: "सूचना" },
    category: "celebration"
  }],
  wedding: {
    couple: { en: "Couple", hi: "युगल" }, date: { en: "Wedding", hi: "विवाह" },
    location: { en: "City", hi: "शहर" }, weddingMoment: "2099-12-31T18:00:00.000Z"
  },
  rsvp: null
};

function apiRequest(path: string, method = "GET", body?: unknown, token = serviceToken) {
  return new Request(`http://api.internal${path}`, {
    method,
    headers: {
      "X-Backend-Service-Token": token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

describe("private API contract", () => {
  beforeEach(() => {
    vi.stubEnv("BACKEND_SERVICE_TOKEN", serviceToken);
    mocks.mode.mockReset().mockReturnValue("database");
    mocks.manageSession.mockReset().mockResolvedValue(true);
    mocks.resolveInvitation.mockReset().mockResolvedValue(resolvedInvitation);
    mocks.saveDatabaseRSVP.mockReset().mockResolvedValue({
      record: { updatedAt: "2099-12-30T10:00:00.000Z" }, entryPass: null
    });
    mocks.saveCoordinatorRSVP.mockReset().mockResolvedValue({ kind: "saved", updatedAt: "2099-12-30T10:00:00.000Z" });
    mocks.getDatabasePool.mockReset().mockReturnValue({ query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }) });
    mocks.getIssuerOptions.mockReset();
    mocks.listInvitations.mockReset();
    mocks.loadContent.mockReset();
    mocks.validateIssue.mockReset();
    mocks.validateContact.mockReset();
    mocks.issueInvitation.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("authenticates coordinator session operations before reading bodies or storage", async () => {
    const input = { action: "validate", sessionHash: "a".repeat(64) };
    expect((await handleApiRequest(apiRequest("/v1/security/coordinator-session", "POST", input, "wrong"))).status).toBe(401);
    expect(mocks.manageSession).not.toHaveBeenCalled();
    expect((await handleApiRequest(apiRequest("/v1/security/coordinator-session", "GET"))).status).toBe(405);
  });

  it("accepts bounded session hashes and rejects raw cookies or extra fields", async () => {
    for (const action of ["validate", "revoke", "register"]) {
      const input = { action, sessionHash: "a".repeat(64), ...(action === "register" ? { expiresAt: "2099-01-01T00:00:00.000Z" } : {}) };
      const response = await handleApiRequest(apiRequest("/v1/security/coordinator-session", "POST", input));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    }
    for (const input of [
      { action: "validate", sessionHash: "not-a-hash" },
      { action: "register", sessionHash: "a".repeat(64) },
      { action: "validate", sessionHash: "a".repeat(64), cookie: "synthetic-cookie" }
    ]) {
      expect((await handleApiRequest(apiRequest("/v1/security/coordinator-session", "POST", input))).status).toBe(400);
    }
    expect(mocks.manageSession).toHaveBeenCalledTimes(3);
  });

  it("reports inactive sessions and blocks access when the shared store fails", async () => {
    const input = { action: "validate", sessionHash: "a".repeat(64) };
    mocks.manageSession.mockResolvedValueOnce(false);
    await expect((await handleApiRequest(apiRequest("/v1/security/coordinator-session", "POST", input))).json()).resolves.toEqual({ ok: false });
    mocks.manageSession.mockRejectedValueOnce(new Error("internal details must stay private"));
    const response = await handleApiRequest(apiRequest("/v1/security/coordinator-session", "POST", input));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("internal details");
    mocks.mode.mockReturnValue("hosted");
    expect((await handleApiRequest(apiRequest("/v1/security/coordinator-session", "POST", input))).status).toBe(404);
  });

  it("authenticates before parsing or touching storage, including Unicode tokens", async () => {
    const malformed = new Request("http://api.internal/v1/invitations/resolve", {
      method: "POST", headers: { "X-Backend-Service-Token": "wrong", "Content-Type": "text/plain" }, body: "not json"
    });
    expect((await handleApiRequest(malformed)).status).toBe(401);
    expect((await handleApiRequest(apiRequest("/v1/status", "GET", undefined, "å".repeat(serviceToken.length)))).status).toBe(401);
    expect(mocks.mode).not.toHaveBeenCalled();
    expect(mocks.resolveInvitation).not.toHaveBeenCalled();
  });

  it("keeps liveness cheap and checks dependency readiness separately", async () => {
    const health = await handleApiRequest(apiRequest("/healthz", "GET", undefined, "wrong"));
    expect(health.status).toBe(200);
    expect(mocks.getDatabasePool).not.toHaveBeenCalled();

    const ready = await handleApiRequest(apiRequest("/v1/readyz"));
    expect(ready.status).toBe(200);
    expect(mocks.getDatabasePool).toHaveBeenCalledTimes(1);
    mocks.getDatabasePool.mockImplementationOnce(() => { throw new Error("DB down"); });
    expect((await handleApiRequest(apiRequest("/readyz", "GET", undefined, "wrong"))).status).toBe(503);
  });

  it("authenticates the shared limiter before reading its body and rejects malformed policies before SQL", async () => {
    const input = { keyHash: "a".repeat(64), maxRequests: 1, windowMs: 120_000 };
    expect((await handleApiRequest(apiRequest("/v1/security/rate-limit", "POST", input, "wrong"))).status).toBe(401);
    expect(mocks.getDatabasePool).not.toHaveBeenCalled();
    for (const body of [
      { ...input, keyHash: "192.0.2.1" }, { ...input, maxRequests: 0 },
      { ...input, maxRequests: 1001 }, { ...input, windowMs: 999 }, { ...input, windowMs: 3600001 },
      { ...input, token: "private-token" }
    ]) {
      expect((await handleApiRequest(apiRequest("/v1/security/rate-limit", "POST", body))).status).toBe(400);
    }
    expect((await handleApiRequest(apiRequest("/v1/security/rate-limit", "GET"))).status).toBe(405);
    expect(mocks.getDatabasePool).not.toHaveBeenCalled();

    // An empty/malformed database contract is a blocked limit, never a permit.
    const blocked = await handleApiRequest(apiRequest("/v1/security/rate-limit", "POST", input));
    await expect(blocked.json()).resolves.toEqual({ allowed: false, retryAfterSeconds: 60 });
    mocks.getDatabasePool.mockReturnValueOnce({ query: vi.fn().mockResolvedValue({ rows: [{ allowed: true, retry_after_seconds: 0 }] }) });
    const allowed = await handleApiRequest(apiRequest("/v1/security/rate-limit", "POST", input));
    await expect(allowed.json()).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    mocks.getDatabasePool.mockImplementationOnce(() => { throw new Error("storage offline"); });
    const failed = await handleApiRequest(apiRequest("/v1/security/rate-limit", "POST", input));
    await expect(failed.json()).resolves.toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it("returns the private invitation DTO from a POST body and saves a validated RSVP", async () => {
    const resolved = await handleApiRequest(apiRequest("/v1/invitations/resolve", "POST", { token: invitationToken }));
    expect(resolved.status).toBe(200);
    expect(resolved.headers.get("cache-control")).toContain("no-store");
    expect(resolved.headers.get("access-control-allow-origin")).toBeNull();
    await expect(resolved.json()).resolves.toEqual({ ok: true, resolved: resolvedInvitation });

    const rsvp = {
      token: invitationToken, respondentName: "Test Guest", status: "attending",
      attendances: [{ eventId: "event-one", attending: true, adults: 2, children: 0 }]
    };
    const submitted = await handleApiRequest(apiRequest("/v1/rsvp", "POST", rsvp));
    expect(submitted.status).toBe(200);
    await expect(submitted.json()).resolves.toEqual({
      ok: true, mode: "database", updatedAt: "2099-12-30T10:00:00.000Z", entryPass: null
    });
    expect(mocks.saveDatabaseRSVP).toHaveBeenCalledWith(rsvp);
  });

  it("returns coordinator workspace/content DTOs without putting credentials in request paths", async () => {
    const issuerOptions = {
      events: [{ id: "event-one", title: { en: "Celebration", hi: "समारोह" } }],
      defaultEventLimits: [{ eventId: "event-one", adults: 2, children: 0 }],
      contactOptions: [{ role: "groom", name: "Desk", phoneDisplay: "+91 98765 43210" }],
      defaultContactRole: "groom"
    };
    const invitations = [{
      id: "3810429c-b718-4ff8-b9bd-b6df41d85f1b", householdName: { en: "Test", hi: "परीक्षण" },
      preferredLocale: "en", contactRole: "groom", status: "active", revokedAt: null,
      rsvpDeletedAt: null, entryPass: null, eventCount: 1, createdAt: "2099-01-01T00:00:00.000Z", rsvp: null
    }];
    const configuration = { revision: "revision", settings: { coupleNamesEn: "Couple" }, events: [], contacts: [] };
    mocks.getIssuerOptions.mockResolvedValue(issuerOptions);
    mocks.listInvitations.mockResolvedValue(invitations);
    mocks.loadContent.mockResolvedValue(configuration);

    const workspace = await handleApiRequest(apiRequest("/v1/coordinator/workspace"));
    await expect(workspace.json()).resolves.toEqual({ ok: true, issuerOptions, invitations });
    const content = await handleApiRequest(apiRequest("/v1/coordinator/content"));
    await expect(content.json()).resolves.toEqual({ ok: true, configuration });
    expect(JSON.stringify(invitations)).not.toContain(invitationToken);
  });

  it("serves a valid empty coordinator workspace but keeps storage failures unavailable", async () => {
    const issuerOptions = { events: [], defaultEventLimits: [], contactOptions: [], defaultContactRole: "groom" };
    mocks.getIssuerOptions.mockResolvedValue(issuerOptions);
    mocks.listInvitations.mockResolvedValue([]);
    const workspace = await handleApiRequest(apiRequest("/v1/coordinator/workspace"));
    expect(workspace.status).toBe(200);
    await expect(workspace.json()).resolves.toEqual({ ok: true, issuerOptions, invitations: [] });

    mocks.getIssuerOptions.mockRejectedValueOnce(new Error("Database connection lost"));
    expect((await handleApiRequest(apiRequest("/v1/coordinator/workspace"))).status).toBe(503);
    mocks.listInvitations.mockRejectedValueOnce(new Error("Database connection lost"));
    expect((await handleApiRequest(apiRequest("/v1/coordinator/workspace"))).status).toBe(503);
  });

  it("issues only a raw one-response credential for the web BFF to turn into a share URL", async () => {
    const input = {
      householdNameEn: "Test household", householdNameHi: "", preferredLocale: "en",
      eventLimits: [{ eventId: "event-one", adults: 2, children: 0 }]
    };
    const issued = {
      id: "3810429c-b718-4ff8-b9bd-b6df41d85f1b", token: invitationToken,
      createdAt: "2099-01-01T00:00:00.000Z", householdName: { en: "Test household", hi: "Test household" },
      eventCount: 1, contactRole: "groom"
    };
    mocks.validateIssue.mockResolvedValue({ ok: true, value: { ...input, contactRole: "groom" } });
    mocks.validateContact.mockResolvedValue({ ok: true });
    mocks.issueInvitation.mockResolvedValue(issued);

    const response = await handleApiRequest(apiRequest("/v1/coordinator/invitations", "POST", input));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, issued });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.url).not.toContain(invitationToken);
  });

  it("authenticates coordinator corrections and returns only a safe revision", async () => {
    const input = {
      invitationId: "3810429c-b718-4ff8-b9bd-b6df41d85f1b", respondentName: "Phone response",
      status: "attending", attendances: [{ eventId: "event-one", attending: true, adults: 1, children: 0 }],
      comfortNote: "Vegetarian", expectedUpdatedAt: null
    };
    expect((await handleApiRequest(apiRequest("/v1/coordinator/rsvp", "POST", input, "wrong"))).status).toBe(401);
    expect(mocks.saveCoordinatorRSVP).not.toHaveBeenCalled();
    const response = await handleApiRequest(apiRequest("/v1/coordinator/rsvp", "POST", input));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, updatedAt: "2099-12-30T10:00:00.000Z" });
    expect(mocks.saveCoordinatorRSVP).toHaveBeenCalledWith(input, "groom");
    expect(mocks.resolveInvitation).not.toHaveBeenCalled();
    expect(mocks.saveDatabaseRSVP).not.toHaveBeenCalled();
    for (const [kind, status] of [["stale", 409], ["not_found", 404], ["invalid", 422]] as const) {
      mocks.saveCoordinatorRSVP.mockResolvedValueOnce({ kind });
      expect((await handleApiRequest(apiRequest("/v1/coordinator/rsvp", "POST", input))).status).toBe(status);
    }
    expect((await handleApiRequest(apiRequest("/v1/coordinator/rsvp", "POST", { ...input, token: invitationToken }))).status).toBe(400);
    expect((await handleApiRequest(apiRequest("/v1/coordinator/rsvp", "POST", { ...input, status: "declined" }))).status).toBe(400);
  });

  it("binds coordinator reads and corrections to the trusted side while rejecting body overrides", async () => {
    mocks.getIssuerOptions.mockResolvedValue({ side: "bride", events: [], defaultEventLimits: [], contactOptions: [], defaultContactRole: "bride" });
    mocks.listInvitations.mockResolvedValue([]);
    const workspace = apiRequest("/v1/coordinator/workspace");
    workspace.headers.set("X-Wedding-Side", "bride");
    expect((await handleApiRequest(workspace)).status).toBe(200);
    expect(mocks.getIssuerOptions).toHaveBeenCalledWith("bride");
    expect(mocks.listInvitations).toHaveBeenCalledWith("bride");

    const input = {
      invitationId: "3810429c-b718-4ff8-b9bd-b6df41d85f1b", respondentName: "Side response",
      status: "attending", attendances: [{ eventId: "event-one", attending: true, adults: 1, children: 0 }], expectedUpdatedAt: null
    };
    const correction = apiRequest("/v1/coordinator/rsvp", "POST", input);
    correction.headers.set("X-Wedding-Side", "bride");
    expect((await handleApiRequest(correction)).status).toBe(200);
    expect(mocks.saveCoordinatorRSVP).toHaveBeenCalledWith(input, "bride");

    const forged = apiRequest("/v1/coordinator/rsvp", "POST", { ...input, side: "groom" });
    forged.headers.set("X-Wedding-Side", "bride");
    expect((await handleApiRequest(forged)).status).toBe(400);
    expect(mocks.saveCoordinatorRSVP).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed coordinator sides before reading private data and advertises the isolation contract", async () => {
    for (const path of ["workspace", "content", "invitations"]) {
      const request = apiRequest(`/v1/coordinator/${path}`);
      request.headers.set("X-Wedding-Side", "unknown");
      expect((await handleApiRequest(request)).status).toBe(400);
    }
    expect(mocks.getIssuerOptions).not.toHaveBeenCalled();
    expect(mocks.listInvitations).not.toHaveBeenCalled();
    expect(mocks.loadContent).not.toHaveBeenCalled();
    await expect((await handleApiRequest(apiRequest("/v1/status"))).json()).resolves.toMatchObject({ sideIsolation: true });
  });

  it("accepts an expected public invitation side without giving it coordinator authority", async () => {
    const request = apiRequest("/v1/invitations/resolve", "POST", { token: invitationToken, side: "bride" });
    expect((await handleApiRequest(request)).status).toBe(200);
    expect(mocks.resolveInvitation).toHaveBeenCalledWith(invitationToken, "bride");
    expect((await handleApiRequest(apiRequest("/v1/invitations/resolve", "POST", { token: invitationToken, side: "unknown" }))).status).toBe(400);
    expect(mocks.getIssuerOptions).not.toHaveBeenCalled();
  });

  it("defaults an omitted reply-to role to the owner while checking explicit alternates in that same workspace", async () => {
    mocks.validateIssue.mockImplementation(async (value) => ({ ok: true, value }));
    mocks.validateContact.mockResolvedValue({ ok: true });
    mocks.issueInvitation.mockResolvedValue({ id: "3810429c-b718-4ff8-b9bd-b6df41d85f1b", side: "bride" });
    const input = { householdNameEn: "Bride fixture household", eventLimits: [{ eventId: "b-event-one", adults: 2, children: 0 }] };
    const omitted = apiRequest("/v1/coordinator/invitations", "POST", input);
    omitted.headers.set("X-Wedding-Side", "bride");
    expect((await handleApiRequest(omitted)).status).toBe(200);
    expect(mocks.validateContact).toHaveBeenLastCalledWith("bride", "bride");
    expect(mocks.issueInvitation).toHaveBeenLastCalledWith(expect.objectContaining({ contactRole: "bride" }), "bride");

    const explicit = apiRequest("/v1/coordinator/invitations", "POST", { ...input, contactRole: "groom" });
    explicit.headers.set("X-Wedding-Side", "bride");
    expect((await handleApiRequest(explicit)).status).toBe(200);
    expect(mocks.validateContact).toHaveBeenLastCalledWith("groom", "bride");
    expect(mocks.issueInvitation).toHaveBeenLastCalledWith(expect.objectContaining({ contactRole: "groom" }), "bride");

    mocks.validateContact.mockResolvedValueOnce({ ok: false, message: "Configure the alternate contact." });
    const missingAlternate = apiRequest("/v1/coordinator/invitations", "POST", { ...input, contactRole: "groom" });
    missingAlternate.headers.set("X-Wedding-Side", "bride");
    expect((await handleApiRequest(missingAlternate)).status).toBe(422);
    expect(mocks.issueInvitation).toHaveBeenCalledTimes(2);
  });

  it("keeps the legacy issuance response strict while exposing ownership to scoped clients", async () => {
    const input = { householdNameEn: "Groom fixture household", eventLimits: [{ eventId: "event-one", adults: 2, children: 0 }] };
    const issued = { id: "3810429c-b718-4ff8-b9bd-b6df41d85f1b", side: "groom", createdAt: "2099-01-01T00:00:00.000Z", token: invitationToken, householdName: { en: "Groom fixture household", hi: "Groom fixture household" }, eventCount: 1, contactRole: "groom" };
    mocks.validateIssue.mockImplementation(async (value) => ({ ok: true, value }));
    mocks.validateContact.mockResolvedValue({ ok: true });
    mocks.issueInvitation.mockResolvedValue(issued);
    const { side: _side, ...legacyIssued } = issued;
    await expect((await handleApiRequest(apiRequest("/v1/coordinator/invitations", "POST", input))).json()).resolves.toEqual({ ok: true, issued: legacyIssued });
    const scoped = apiRequest("/v1/coordinator/invitations", "POST", input);
    scoped.headers.set("X-Wedding-Side", "groom");
    await expect((await handleApiRequest(scoped)).json()).resolves.toEqual({ ok: true, issued });
    mocks.mode.mockReturnValue("hosted");
    await expect((await handleApiRequest(apiRequest("/v1/status"))).json()).resolves.toMatchObject({ sideIsolation: false });
  });
});
