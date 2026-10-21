import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { resetRateLimitsForTest } from "@/lib/server/rate-limit";
import { COORDINATOR_SESSION_COOKIE, createCoordinatorSession } from "@/lib/server/request-security";

const backend = vi.hoisted(() => ({ requestBackend: vi.fn(), forwardBackendJson: vi.fn(), backendCoordinatorAvailability: vi.fn(), resolvePublicInvitation: vi.fn(), resolveBackendInvitation: vi.fn() }));
vi.mock("@/lib/server/backend-client", () => backend);
const sessions = vi.hoisted(() => ({ manage: vi.fn() }));
vi.mock("@/lib/server/coordinator-session-store", () => ({ manageCoordinatorSession: sessions.manage }));

import { POST as publicRsvp } from "@/app/api/public/rsvp/route";
import { POST as bulkInvitations } from "@/app/api/coordinator/invitations/bulk/route";
import { POST as calendar } from "@/app/api/calendar/[eventId]/route";

const token = "synthetic-private-invitation-token-12345678";
const details = { side: "bride", respondentName: "Synthetic Guest", contactNumber: "+1 202 555 0101", status: "declined", attendances: [{ eventId: "test-bride-event", attending: false, adults: 0, children: 0 }] };
const issued = { id: "3810429c-b718-4ff8-b9bd-b6df41d85f1b", side: "bride", token, createdAt: "2099-01-01T00:00:00.000Z", householdName: { en: "Synthetic Guest", hi: "Synthetic Guest" }, eventCount: 1, contactRole: "bride", contactNumber: details.contactNumber };

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost", "X-Forwarded-For": "203.0.113.77", ...headers }, body: JSON.stringify(body) });
}
function cookie() { return `${COORDINATOR_SESSION_COOKIE}=${createCoordinatorSession(Date.now(), "bride")}`; }

describe("public RSVP and bulk invitation browser boundaries", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PUBLIC_APP_ORIGIN", undefined);
    vi.stubEnv("COORDINATOR_PASSWORD", "synthetic-groom-password-1234567890");
    vi.stubEnv("COORDINATOR_BRIDE_PASSWORD", "synthetic-bride-password-1234567890");
    vi.stubEnv("COORDINATOR_SESSION_SECRET", "synthetic-session-secret-abcdefghijklmnopqrstuvwxyz");
    resetRateLimitsForTest();
    sessions.manage.mockReset().mockResolvedValue(true);
    backend.requestBackend.mockReset();
    backend.forwardBackendJson.mockReset().mockImplementation(async (response: Response) => ({ payload: await response.json(), status: response.status }));
    backend.backendCoordinatorAvailability.mockReset().mockResolvedValue("available");
    backend.resolvePublicInvitation.mockReset();
    backend.resolveBackendInvitation.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("requires same-origin public submissions, a valid contact and no private credential", async () => {
    expect((await publicRsvp(post("/api/public/rsvp", details, { Origin: "https://outside.example" }))).status).toBe(403);
    expect((await publicRsvp(post("/api/public/rsvp", { ...details, contactNumber: "" }))).status).toBe(400);
    expect((await publicRsvp(post("/api/public/rsvp", { ...details, token }))).status).toBe(400);
    expect((await publicRsvp(post("/api/public/rsvp", { ...details, attendances: [details.attendances[0], details.attendances[0]] }))).status).toBe(400);
    expect(backend.requestBackend).not.toHaveBeenCalled();
  });

  it("returns only the new guest's private edit link and applies contact throttling", async () => {
    backend.requestBackend.mockImplementation(async () => Response.json({ ok: true, token, updatedAt: issued.createdAt, entryPass: null, resolved: { internal: "not forwarded" } }));
    const response = await publicRsvp(post("/api/public/rsvp", details));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true, token, mode: "database", updatedAt: issued.createdAt, entryPass: null, invitationUrl: `http://localhost/i/b/${token}` });
    expect(backend.requestBackend).toHaveBeenCalledWith("/v1/public/rsvp", { method: "POST", body: details });
    await publicRsvp(post("/api/public/rsvp", details));
    await publicRsvp(post("/api/public/rsvp", details));
    expect((await publicRsvp(post("/api/public/rsvp", { ...details, contactNumber: "1 (202) 555-0101" }))).status).toBe(429);
    expect(backend.requestBackend).toHaveBeenCalledTimes(3);
  });

  it("keeps bulk import authenticated and bound to the coordinator's side", async () => {
    const body = { csv: "name,contactnumber\nSynthetic Guest,+12025550101", eventLimits: [{ eventId: "test-bride-event", adults: 2, children: 0 }] };
    expect((await bulkInvitations(post("/api/coordinator/b/invitations/bulk", body))).status).toBe(403);
    expect((await bulkInvitations(post("/api/coordinator/g/invitations/bulk", body, { Cookie: cookie() }))).status).toBe(403);
    backend.requestBackend.mockResolvedValueOnce(Response.json({ ok: true, issued: [issued] }));
    const response = await bulkInvitations(post("/api/coordinator/b/invitations/bulk", body, { Cookie: cookie() }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const payload = await response.json();
    expect(payload.invitations[0]).toMatchObject({ invitationId: issued.id, invitationUrl: `http://localhost/i/b/${token}`, contactNumber: details.contactNumber });
    expect(payload.invitations[0].token).toBeUndefined();
    expect(backend.requestBackend).toHaveBeenCalledWith("/v1/coordinator/invitations/bulk", { method: "POST", body, side: "bride" });
  });

  it("preserves CSV row errors and rejects mismatched issued owners", async () => {
    const headers = { Cookie: cookie() };
    backend.requestBackend.mockResolvedValueOnce(Response.json({ error: "Row 3: enter a valid contact number." }, { status: 422 }));
    const invalid = await bulkInvitations(post("/api/coordinator/b/invitations/bulk", {}, headers));
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toEqual({ error: "Row 3: enter a valid contact number." });
    backend.requestBackend.mockResolvedValueOnce(Response.json({ ok: true, issued: [{ ...issued, side: "groom" }] }));
    expect((await bulkInvitations(post("/api/coordinator/b/invitations/bulk", {}, headers))).status).toBe(503);
  });

  it("resolves public calendars only through public event selection", async () => {
    backend.resolvePublicInvitation.mockResolvedValue({ events: [{ id: "test-bride-event", title: { en: "Synthetic event", hi: "समारोह" }, startIso: "2099-12-30T19:00:00.000Z", endIso: "2099-12-30T22:00:00.000Z", venue: { en: "Venue", hi: "स्थल" }, address: { en: "Address", hi: "पता" }, arrivalWindow: { en: "7 PM", hi: "शाम" }, practicalNote: { en: "Note", hi: "सूचना" } }] });
    const context = { params: Promise.resolve({ eventId: "test-bride-event" }) };
    expect((await calendar(post("/api/calendar/test-bride-event", { publicSide: "bride" }), context)).status).toBe(200);
    expect(backend.resolvePublicInvitation).toHaveBeenCalledWith("bride");
    expect(backend.resolveBackendInvitation).not.toHaveBeenCalled();
    expect((await calendar(post("/api/calendar/test-bride-event", { publicSide: "bride", token }), context)).status).toBe(400);
  });
});
