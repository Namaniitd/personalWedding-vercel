import { describe, expect, it } from "vitest";

import { coordinatorRsvpDraft, coordinatorRsvpSchema, coordinatorRsvpValidation } from "@/lib/coordinator-rsvp";
import type { DatabaseCoordinatorInvitation } from "@/lib/types";

const invitation: DatabaseCoordinatorInvitation = {
  id: "11111111-1111-4111-8111-111111111111", householdName: { en: "Test family", hi: "परिवार" }, preferredLocale: "en", contactRole: "groom", status: "active", revokedAt: null, rsvpDeletedAt: null, entryPass: null,
  createdAt: "2020-01-01T00:00:00.000Z", eventCount: 2,
  eventLimits: [{ eventId: "ceremony", adults: 2, children: 1 }, { eventId: "reception", adults: 2, children: 0 }],
  rsvp: null
};

describe("coordinator phone RSVP editing", () => {
  it("records an old invitation without a bearer credential or guest deadline", () => {
    const draft = coordinatorRsvpDraft(invitation);
    draft.respondentName = "Guest One";
    draft.attendances[0] = { eventId: "ceremony", attending: true, adults: 2, children: 1 };
    expect(coordinatorRsvpValidation(draft, invitation)).toBeNull();
    expect(draft.expectedUpdatedAt).toBeNull();
    expect(draft).not.toHaveProperty("token");
  });

  it("loads the saved name, needs, per-event counts and concurrency timestamp", () => {
    const saved: DatabaseCoordinatorInvitation = { ...invitation, rsvp: { respondentName: "Guest One", status: "attending", attendances: [{ eventId: "ceremony", attending: true, adults: 2, children: 1 }], comfortNote: "Step-free access", updatedAt: "2026-10-09T10:00:00.000Z" } };
    const draft = coordinatorRsvpDraft(saved);
    expect(draft).toMatchObject({ respondentName: "Guest One", comfortNote: "Step-free access", expectedUpdatedAt: saved.rsvp!.updatedAt });
    expect(draft.attendances).toHaveLength(2);
    expect(draft.attendances[1]).toEqual({ eventId: "reception", attending: false, adults: 0, children: 0 });
  });

  it("rejects revoked links, uninvited events, zero guests, missing events and excessive counts", () => {
    const draft = { ...coordinatorRsvpDraft(invitation), respondentName: "Guest One" };
    expect(coordinatorRsvpValidation(draft, { ...invitation, status: "revoked" })).toMatch(/revoked/);
    expect(coordinatorRsvpValidation(draft, invitation)).toMatch(/at least one celebration/);
    draft.attendances[0] = { eventId: "ceremony", attending: true, adults: 3, children: 0 };
    expect(coordinatorRsvpValidation(draft, invitation)).toMatch(/exceeds/);
    draft.attendances[0].adults = 0;
    expect(coordinatorRsvpValidation(draft, invitation)).toMatch(/at least one guest/);
    draft.attendances[0].eventId = "other-event";
    expect(coordinatorRsvpValidation(draft, invitation)).toMatch(/not on/);
    draft.attendances.pop();
    expect(coordinatorRsvpValidation(draft, invitation)).toMatch(/every celebration/);
  });

  it("requires the optimistic timestamp and rejects duplicate events or a bearer token", () => {
    const draft = { ...coordinatorRsvpDraft(invitation), respondentName: "Guest One", status: "declined" as const, declineMessage: "Best wishes!" };
    expect(coordinatorRsvpSchema.safeParse(draft).success).toBe(true);
    expect(coordinatorRsvpSchema.safeParse({ ...draft, expectedUpdatedAt: undefined }).success).toBe(false);
    expect(coordinatorRsvpSchema.safeParse({ ...draft, token: "secret-bearer-token" }).success).toBe(false);
    expect(coordinatorRsvpSchema.safeParse({ ...draft, attendances: [draft.attendances[0], draft.attendances[0]] }).success).toBe(false);
  });
});
