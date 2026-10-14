import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { resetRateLimitsForTest } from "@/lib/server/rate-limit";

const backend = vi.hoisted(() => ({
  requestBackend: vi.fn(),
  resolveBackendInvitation: vi.fn(),
  forwardBackendJson: vi.fn()
}));

vi.mock("@/lib/server/backend-client", () => backend);

import { POST as calendarPost } from "@/app/api/calendar/[eventId]/route";
import { POST as rsvpPost } from "@/app/api/rsvp/route";

const token = "test-invitation-token-abcdefghijklmnopqrstuvwxyz";
const rsvp = {
  token,
  respondentName: "Test Guest",
  status: "attending",
  attendances: [{ eventId: "celebration", attending: true, adults: 2, children: 0 }]
};

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "203.0.113.10",
      ...headers
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

describe("guest browser API boundary", () => {
  beforeEach(() => {
    resetRateLimitsForTest();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PUBLIC_APP_ORIGIN", undefined);
    backend.requestBackend.mockReset().mockResolvedValue(Response.json({ ok: true, mode: "database", entryPass: null }));
    backend.forwardBackendJson.mockReset().mockImplementation(async (response: Response) => ({
      payload: await response.json(), status: response.status, headers: undefined
    }));
    backend.resolveBackendInvitation.mockReset().mockResolvedValue({
      events: [{
        id: "celebration",
        title: { en: "Celebration", hi: "समारोह" },
        startIso: "2099-12-30T19:00:00.000Z", endIso: "2099-12-30T22:00:00.000Z",
        venue: { en: "Venue", hi: "स्थल" }, address: { en: "Address", hi: "पता" },
        arrivalWindow: { en: "7 PM", hi: "शाम 7 बजे" }, practicalNote: { en: "Note", hi: "सूचना" }
      }]
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects cross-origin, non-JSON, oversized, and duplicate RSVP requests before forwarding", async () => {
    expect((await rsvpPost(post("/api/rsvp", rsvp, { Origin: "https://attacker.example" }))).status).toBe(403);
    expect((await rsvpPost(post("/api/rsvp", rsvp, { "Content-Type": "text/plain" }))).status).toBe(415);
    expect((await rsvpPost(post("/api/rsvp", { padding: "x".repeat(17_000) }))).status).toBe(413);
    expect((await rsvpPost(post("/api/rsvp", {
      ...rsvp, attendances: [rsvp.attendances[0], rsvp.attendances[0]]
    }))).status).toBe(400);
    expect(backend.requestBackend).not.toHaveBeenCalled();
  });

  it("forwards a valid RSVP body and preserves private backend status without exposing CORS", async () => {
    const success = await rsvpPost(post("/api/rsvp", rsvp));
    expect(success.status).toBe(200);
    expect(success.headers.get("cache-control")).toContain("no-store");
    expect(success.headers.get("access-control-allow-origin")).toBeNull();
    expect(backend.requestBackend).toHaveBeenCalledWith("/v1/rsvp", { method: "POST", body: rsvp });

    backend.requestBackend.mockResolvedValueOnce(Response.json({ error: "Online RSVPs are now closed." }, { status: 422 }));
    const closed = await rsvpPost(post("/api/rsvp", rsvp));
    expect(closed.status).toBe(422);
    await expect(closed.json()).resolves.toEqual({ error: "Online RSVPs are now closed." });
  });

  it("generates an ICS only for an event in the resolved private invitation", async () => {
    const context = { params: Promise.resolve({ eventId: "celebration" }) };
    const valid = await calendarPost(post("/api/calendar/celebration", { token }), context);
    expect(valid.status).toBe(200);
    expect(valid.headers.get("content-type")).toContain("text/calendar");
    expect(valid.headers.get("cache-control")).toContain("no-store");
    expect(backend.resolveBackendInvitation).toHaveBeenCalledWith(token);

    expect((await calendarPost(post("/api/calendar/celebration", { token }, { Origin: "https://attacker.example" }), context)).status).toBe(403);
    expect((await calendarPost(post("/api/calendar/celebration", { token, extra: true }), context)).status).toBe(400);
    backend.resolveBackendInvitation.mockResolvedValueOnce(null);
    expect((await calendarPost(post("/api/calendar/celebration", { token }), context)).status).toBe(404);
  });

  it("returns a generic service error when the private API is unreachable", async () => {
    backend.requestBackend.mockRejectedValueOnce(new Error("connection failed"));
    const response = await rsvpPost(post("/api/rsvp", rsvp));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "The invitation service is temporarily unavailable." });
  });
});
