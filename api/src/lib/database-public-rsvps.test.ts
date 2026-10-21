import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), release: vi.fn(), connect: vi.fn(), configuration: vi.fn(),
  lock: vi.fn(), issue: vi.fn(), save: vi.fn()
}));

vi.mock("./database-rsvps", () => ({
  getDatabasePool: () => ({ connect: mocks.connect }),
  saveDatabaseRSVPInTransaction: mocks.save
}));
vi.mock("./database-invitations", () => ({ issueDatabaseInvitationInTransaction: mocks.issue }));
vi.mock("./database-content-lock", () => ({ lockDatabaseContentAndInvitationIssue: mocks.lock }));
vi.mock("./database-wedding-content", () => ({
  loadDatabaseWeddingConfiguration: mocks.configuration,
  databaseWeddingContact: (configuration: { contacts: Record<string, unknown> }, role: string) => configuration.contacts[role]
}));

import {
  publicRsvpSubmissionSchema,
  resolveDatabasePublicInvitation,
  submitDatabasePublicRSVP
} from "./database-public-rsvps";

const client = { query: mocks.query, release: mocks.release };
const contact = {
  role: "bride", name: "Coordination desk", phoneDisplay: "+1 202 555 0100",
  phoneHref: "tel:+12025550100", whatsappHref: "https://wa.me/12025550100"
};
const configuration = {
  wedding: { couple: { en: "Couple", hi: "युगल" } },
  rsvpDeadline: { en: "December 2099", hi: "दिसंबर 2099" },
  rsvpDeadlineIso: "2099-12-31T23:59:59.000Z",
  rsvpDeadlineAt: "2099-12-31T23:59:59.000Z",
  events: [
    { event: { id: "public-event" }, defaultSelected: true, defaultAdults: 2, defaultChildren: 1 },
    { event: { id: "private-event" }, defaultSelected: false, defaultAdults: 10, defaultChildren: 2 }
  ],
  contacts: { bride: contact }
};
const input = {
  side: "bride" as const,
  respondentName: "Sample Guest",
  contactNumber: "+1 202 555 0101",
  status: "attending" as const,
  attendances: [{ eventId: "public-event", attending: true, adults: 2, children: 0 }]
};

describe("public RSVP registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockReset().mockResolvedValue({ rows: [] });
    mocks.connect.mockResolvedValue(client);
    mocks.configuration.mockReset().mockResolvedValue(configuration);
    mocks.issue.mockReset().mockResolvedValue({ token: "private-invitation-token", householdName: { en: "Sample Guest", hi: "Sample Guest" } });
    mocks.save.mockReset().mockImplementation(async (_client, details) => ({
      record: { ...details, updatedAt: "2099-01-01T00:00:00.000Z" }, entryPass: null
    }));
  });

  it("exposes only default events without looking up any private household", async () => {
    const resolved = await resolveDatabasePublicInvitation("bride");
    expect(mocks.configuration).toHaveBeenCalledWith(undefined, "bride");
    expect(resolved.invitation).toMatchObject({
      kind: "public", side: "bride", token: "public-invitation-bride",
      eventIds: ["public-event"], eventLimits: { "public-event": { adults: 2, children: 1 } }
    });
    expect(resolved.invitation).not.toHaveProperty("contactNumber");
    expect(resolved.rsvp).toBeNull();
    expect(mocks.issue).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("requires a contact number and rejects private-token fields", () => {
    expect(publicRsvpSubmissionSchema.safeParse({ ...input, contactNumber: "" }).success).toBe(false);
    expect(publicRsvpSubmissionSchema.safeParse({ ...input, contactNumber: undefined }).success).toBe(false);
    expect(publicRsvpSubmissionSchema.safeParse({ ...input, token: "private-invitation-token" }).success).toBe(false);
    expect(publicRsvpSubmissionSchema.safeParse(input).success).toBe(true);
  });

  it("refuses public templates without 1 to 12 default celebrations", async () => {
    mocks.configuration.mockResolvedValueOnce({ ...configuration, events: [] });
    await expect(resolveDatabasePublicInvitation("bride")).rejects.toThrow("between 1 and 12");
    mocks.configuration.mockResolvedValueOnce({ ...configuration, events: Array.from({ length: 13 }, (_, index) => ({ ...configuration.events[0], event: { id: `event-${index}` } })) });
    await expect(resolveDatabasePublicInvitation("bride")).rejects.toThrow("between 1 and 12");
  });

  it("atomically creates an independent private invitation and response", async () => {
    const saved = await submitDatabasePublicRSVP(input);
    expect(mocks.lock).toHaveBeenCalledWith(client, "bride");
    expect(mocks.configuration).toHaveBeenCalledWith(client, "bride");
    expect(mocks.issue).toHaveBeenCalledWith(client, {
      householdNameEn: "Sample Guest", contactNumber: input.contactNumber,
      preferredLocale: "en", contactRole: "bride",
      eventLimits: [{ eventId: "public-event", adults: 2, children: 1 }]
    }, "bride", configuration);
    expect(mocks.save).toHaveBeenCalledWith(client, {
      respondentName: input.respondentName, contactNumber: input.contactNumber,
      status: input.status, attendances: input.attendances, token: "private-invitation-token"
    });
    expect(mocks.query.mock.calls.map(([query]) => query)).toEqual(["begin", "commit"]);
    expect(saved.resolved.invitation).toMatchObject({ kind: "private", token: "private-invitation-token", contactNumber: input.contactNumber });
    expect(saved.resolved.rsvp?.token).toBe("private-invitation-token");
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("rejects a crafted event selection before creating a private invitation", async () => {
    await expect(submitDatabasePublicRSVP({
      ...input, attendances: [{ eventId: "private-event", attending: true, adults: 1, children: 0 }]
    })).rejects.toThrow("does not include");
    expect(mocks.issue).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.map(([query]) => query)).toEqual(["begin", "rollback"]);
  });

  it("rolls back the new private invitation if its RSVP cannot be saved", async () => {
    mocks.save.mockRejectedValue(new Error("Database failure"));
    await expect(submitDatabasePublicRSVP(input)).rejects.toThrow("Database failure");
    expect(mocks.query.mock.calls.map(([query]) => query)).toEqual(["begin", "rollback"]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("fails before issuance when the public RSVP deadline has passed", async () => {
    mocks.configuration.mockResolvedValue({ ...configuration, rsvpDeadlineIso: "2000-01-01T00:00:00.000Z" });
    await expect(submitDatabasePublicRSVP(input)).rejects.toThrow("now closed");
    expect(mocks.issue).not.toHaveBeenCalled();
  });
});
