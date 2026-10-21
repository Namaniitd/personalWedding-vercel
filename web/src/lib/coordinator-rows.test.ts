import { describe, expect, it } from "vitest";

import {
  activeInvitationRows,
  buildCoordinatorCsv,
  filterOptions,
  invitationRow,
  matchesRSVPFilter,
  sortCoordinatorRows,
  summariseEventAttendance,
  summariseRows
} from "@/lib/coordinator-rows";
import type { DatabaseCoordinatorInvitation, DatabaseInvitationIssuerOptions } from "@/lib/types";

function invitation(overrides: Partial<DatabaseCoordinatorInvitation> = {}): DatabaseCoordinatorInvitation {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    householdName: { en: "Mehta household", hi: "मेहता परिवार" },
    preferredLocale: "en",
    contactRole: "groom",
    status: "active",
    revokedAt: null,
    rsvpDeletedAt: null,
    entryPass: null,
    eventCount: 1,
    eventLimits: [{ eventId: "sangeet", adults: 2, children: 1 }],
    createdAt: "2026-08-01T08:00:00.000Z",
    rsvp: null,
    ...overrides
  };
}

const attendingRsvp = {
  respondentName: "Anita Mehta",
  status: "attending" as const,
  attendances: [{ eventId: "sangeet", attending: true, adults: 2, children: 1 }],
  updatedAt: "2026-08-04T08:00:00.000Z"
};

const confirmingRsvp = {
  respondentName: "Anita Mehta",
  status: "confirming" as const,
  attendances: [{ eventId: "sangeet", attending: false, adults: 0, children: 0 }],
  updatedAt: "2026-08-05T08:00:00.000Z"
};

const declinedRsvp = {
  respondentName: "Anita Mehta",
  status: "declined" as const,
  attendances: [{ eventId: "sangeet", attending: false, adults: 0, children: 0 }],
  updatedAt: "2026-08-06T08:00:00.000Z"
};

const issuerOptions: DatabaseInvitationIssuerOptions = {
  events: [{ id: "sangeet", title: { en: "Sangeet", hi: "संगीत" } }, { id: "ceremony", title: { en: "Wedding ceremony", hi: "विवाह समारोह" } }],
  defaultEventLimits: [],
  contactOptions: [{ role: "groom", name: "Naman", phoneDisplay: "+91 98765 43210" }],
  defaultContactRole: "groom"
};

describe("coordinator RSVP rows", () => {
  it("shows guest numbers in rows and exports without restoring a cleared reply number", () => {
    const invited = invitation({ contactNumber: "+91 90000 00000" });
    expect(invitationRow(invited).contactNumber).toBe("+91 90000 00000");
    expect(buildCoordinatorCsv([invited], issuerOptions)).toContain('"\'+91 90000 00000"');
    const cleared = { ...invited, rsvp: attendingRsvp };
    expect(invitationRow(cleared).contactNumber).toBe("");
    expect(buildCoordinatorCsv([cleared], issuerOptions)).not.toContain("90000");
  });
  it("keeps provisional replies visible as Confirming instead of treating them as final responses", () => {
    expect(invitationRow(invitation()).state).toBe("Pending");
    expect(invitationRow(invitation({ rsvp: attendingRsvp })).state).toBe("Responded");
    expect(invitationRow(invitation({ rsvp: confirmingRsvp })).state).toBe("Confirming");
    expect(invitationRow(invitation({ rsvp: declinedRsvp })).state).toBe("Declined");
  });

  it("exports only recorded household fields and escapes spreadsheet formulas", () => {
    const row = invitationRow(invitation({ householdName: { en: "=2+2", hi: "मेहता परिवार" } }));
    const csv = buildCoordinatorCsv([invitation({ householdName: { en: "=2+2", hi: "मेहता परिवार" } })], issuerOptions);
    expect(row).not.toHaveProperty("owner");
    expect(csv.split("\n")[0]).toContain('"Household","Event","RSVP state","Event attendance","Adults","Children","Respondent","Hospitality requests"');
    expect(csv).toContain('"\'=2+2"');
    expect(csv).not.toContain("Database");
  });

  it("offers both a direct confirmation filter and a combined follow-up view", () => {
    const rows = [
      invitationRow(invitation()),
      invitationRow(invitation({ id: "22222222-2222-4222-8222-222222222222", rsvp: confirmingRsvp })),
      invitationRow(invitation({ id: "33333333-3333-4333-8333-333333333333", rsvp: attendingRsvp }))
    ];

    expect(filterOptions).toContain("Confirming");
    expect(filterOptions).toContain("Needs follow-up");
    expect(rows.filter((row) => matchesRSVPFilter(row, "Confirming")).map((row) => row.state)).toEqual(["Confirming"]);
    expect(rows.filter((row) => matchesRSVPFilter(row, "Needs follow-up")).map((row) => row.state)).toEqual(["Pending", "Confirming"]);
  });

  it("counts provisional replies as replies while retaining them in the follow-up total", () => {
    const rows = activeInvitationRows([
      invitation(),
      invitation({ id: "22222222-2222-4222-8222-222222222222", rsvp: confirmingRsvp }),
      invitation({ id: "33333333-3333-4333-8333-333333333333", rsvp: attendingRsvp }),
      invitation({ id: "44444444-4444-4444-8444-444444444444", rsvp: declinedRsvp }),
      invitation({ id: "55555555-5555-4555-8555-555555555555", status: "revoked", rsvp: confirmingRsvp })
    ]);

    expect(summariseRows(rows)).toMatchObject({
      invited: 4,
      replied: 3,
      pending: 1,
      confirming: 1,
      followUps: 2,
      attendees: 3,
      responseRate: 75
    });
  });

  it("provides per-event catering totals from final active attending RSVPs only", () => {
    const secondAttendingRsvp = {
      respondentName: "Guest Two",
      status: "attending" as const,
      attendances: [
        { eventId: "sangeet", attending: true, adults: 1, children: 0 },
        { eventId: "ceremony", attending: true, adults: 2, children: 2 }
      ],
      updatedAt: "2026-08-07T08:00:00.000Z"
    };
    const totals = summariseEventAttendance([
      invitation({ rsvp: attendingRsvp }),
      invitation({ id: "22222222-2222-4222-8222-222222222222", rsvp: secondAttendingRsvp }),
      invitation({ id: "33333333-3333-4333-8333-333333333333", rsvp: confirmingRsvp }),
      invitation({ id: "44444444-4444-4444-8444-444444444444", status: "revoked", rsvp: attendingRsvp })
    ], [
      { id: "sangeet", title: { en: "Sangeet", hi: "संगीत" } },
      { id: "ceremony", title: { en: "Wedding ceremony", hi: "विवाह समारोह" } }
    ]);

    expect(totals).toEqual([
      { id: "sangeet", title: "Sangeet", households: 2, adults: 3, children: 1, total: 4 },
      { id: "ceremony", title: "Wedding ceremony", households: 1, adults: 2, children: 2, total: 4 }
    ]);
  });

  it("exports every invited celebration separately with respondent, requests and contact", () => {
    const response = { ...attendingRsvp, comfortNote: "Step-free access, please", attendances: [
      { eventId: "sangeet", attending: true, adults: 2, children: 0 },
      { eventId: "ceremony", attending: true, adults: 2, children: 0 }
    ] };
    const invited = invitation({ eventCount: 2, eventLimits: [{ eventId: "sangeet", adults: 2, children: 0 }, { eventId: "ceremony", adults: 2, children: 0 }], rsvp: response });
    const csv = buildCoordinatorCsv([invited, invitation({ status: "revoked" })], issuerOptions);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Sangeet","Responded","Attending","2","0","Anita Mehta","Step-free access, please"');
    expect(lines[2]).toContain('"Wedding ceremony","Responded","Attending","2","0"');
    expect(lines[1]).toContain('"Naman","\'+91 98765 43210"');
    expect(csv).not.toContain('"4"');
  });

  it("keeps pending, provisional and declined attendance clear and escapes note formulas", () => {
    const csv = buildCoordinatorCsv([
      invitation(), invitation({ rsvp: confirmingRsvp }),
      invitation({ rsvp: { ...declinedRsvp, declineMessage: "=HYPERLINK(\"https://example.com\")" } })
    ], issuerOptions);
    expect(csv).toContain('"Awaiting reply","0","0"');
    expect(csv).toContain('"Awaiting confirmation","0","0"');
    expect(csv).toContain('"Declined","Not attending","0","0"');
    expect(csv).toContain("'=" + 'HYPERLINK(""');
  });

  it("sorts recent activity using the full response timestamp rather than issue order or day", () => {
    const rows = [invitationRow(invitation({ id: "newer-issued", createdAt: "2026-08-05T09:00:00.000Z" })),
      invitationRow(invitation({ id: "older-issued", rsvp: { ...attendingRsvp, updatedAt: "2026-08-05T10:00:00.000Z" } }))];
    expect(sortCoordinatorRows(rows, "recent").map((row) => row.invitationId)).toEqual(["older-issued", "newer-issued"]);
  });
});
