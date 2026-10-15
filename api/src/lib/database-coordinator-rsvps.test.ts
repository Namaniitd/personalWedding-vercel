import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./database-rsvps", () => ({ getDatabasePool: () => ({ query }) }));

import { coordinatorRsvpSubmissionSchema, saveDatabaseCoordinatorRSVP } from "./database-coordinator-rsvps";

const input = {
  invitationId: "3810429c-b718-4ff8-b9bd-b6df41d85f1b", respondentName: "Test Guest",
  status: "attending" as const, attendances: [{ eventId: "event-one", attending: true, adults: 2, children: 0 }],
  comfortNote: "Vegetarian", expectedUpdatedAt: null
};

describe("coordinator RSVP operation", () => {
  beforeEach(() => query.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("uses the dedicated SQL operation and never returns credentials or a QR", async () => {
    query.mockResolvedValue({ rows: [{ outcome: "saved", updated_at: new Date("2099-01-01T00:00:00.123Z") }] });
    await expect(saveDatabaseCoordinatorRSVP(input)).resolves.toEqual({ kind: "saved", updatedAt: "2099-01-01T00:00:00.123Z" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("wedding.save_coordinator_rsvp"), [
      input.invitationId, JSON.stringify({ respondentName: input.respondentName, status: input.status, attendances: input.attendances, comfortNote: input.comfortNote }), null, "groom"
    ]);
    for (const outcome of ["stale", "not_found", "invalid"] as const) {
      query.mockResolvedValueOnce({ rows: [{ outcome, updated_at: null }] });
      await expect(saveDatabaseCoordinatorRSVP(input)).resolves.toEqual({ kind: outcome });
    }
  });

  it("rejects unexpected credentials, duplicate events, missing revisions, and inappropriate notes", () => {
    expect(coordinatorRsvpSubmissionSchema.safeParse({ ...input, token: "should-not-be-accepted" }).success).toBe(false);
    expect(coordinatorRsvpSubmissionSchema.safeParse({ ...input, attendances: [...input.attendances, ...input.attendances] }).success).toBe(false);
    expect(coordinatorRsvpSubmissionSchema.safeParse({ ...input, expectedUpdatedAt: undefined }).success).toBe(false);
    expect(coordinatorRsvpSubmissionSchema.safeParse({ ...input, status: "declined" }).success).toBe(false);
  });
});
