import { describe, expect, it } from "vitest";

import { createCalendarEvent } from "@/lib/calendar";
import { defaultAttendances, rsvpSubmissionSchema, validateRSVPForInvitation } from "@/lib/rsvp";
import type { Invitation, RSVPInput, WeddingEvent } from "@/lib/types";

const events: WeddingEvent[] = [
  {
    id: "evening-celebration",
    title: { en: "Evening Celebration", hi: "सांध्य समारोह" },
    date: { en: "Saturday · 28 November", hi: "शनिवार · 28 नवंबर" },
    startTime: { en: "7:30 PM IST", hi: "शाम 7:30 बजे (IST)" },
    arrivalWindow: { en: "Please arrive between 7:00–7:30 PM", hi: "कृपया शाम 7:00–7:30 बजे के बीच पहुँचें" },
    startIso: "2026-11-28T19:30:00+05:30",
    endIso: "2026-11-28T23:30:00+05:30",
    venue: { en: "Celebration venue", hi: "समारोह स्थल" },
    address: { en: "Venue address", hi: "स्थल का पता" },
    mapsUrl: "https://maps.example/venue",
    entryNote: { en: "Use the main entrance.", hi: "मुख्य प्रवेश द्वार का उपयोग करें।" },
    dressCode: { en: "Festive", hi: "उत्सव परिधान" },
    practicalNote: { en: "Please arrive on time.", hi: "कृपया समय पर पहुँचें।" },
    category: "celebration"
  }
];

const invitation: Invitation = {
  token: "test-invitation-token",
  householdName: { en: "Test household", hi: "परीक्षण परिवार" },
  preferredLocale: "en",
  eventIds: ["evening-celebration"],
  eventLimits: { "evening-celebration": { adults: 4, children: 2 } },
  rsvpDeadline: { en: "31 December 2099", hi: "31 दिसंबर 2099" },
  rsvpDeadlineIso: "2099-12-31T23:59:59+05:30",
  coordinator: {
    role: "groom",
    name: "Wedding coordination desk",
    phoneDisplay: "+91 98765 43210",
    phoneHref: "tel:+919876543210",
    whatsappHref: "https://wa.me/919876543210"
  }
};

const liveLikeInvitation = {
  ...invitation,
  rsvpDeadlineIso: "2099-12-31T23:59:59+05:30"
};

function input(overrides: Partial<RSVPInput> = {}): RSVPInput {
  return {
    token: invitation.token,
    respondentName: "Test respondent",
    status: "attending",
    attendances: defaultAttendances(liveLikeInvitation).map((attendance, index) => index === 0 ? { ...attendance, attending: true, adults: 2 } : attendance),
    ...overrides
  };
}

describe("RSVP validation", () => {
  it("accepts optional contact numbers while validating real phone input", () => {
    expect(rsvpSubmissionSchema.safeParse(input()).success).toBe(true);
    expect(rsvpSubmissionSchema.parse(input({ contactNumber: " +91 (98765) 43210 " })).contactNumber).toBe("+91 (98765) 43210");
    expect(rsvpSubmissionSchema.safeParse(input({ contactNumber: "" })).success).toBe(true);
    for (const contactNumber of ["12345", "+1234567890123456", "guest@example.com", "91+9876543210"]) {
      expect(rsvpSubmissionSchema.safeParse(input({ contactNumber })).success).toBe(false);
    }
  });

  it("accepts an invited event within its hard adult and child limits", () => {
    const result = validateRSVPForInvitation(input(), { invitation: liveLikeInvitation, events });
    expect(result.ok).toBe(true);
  });

  it("does not accept attendance above an invitation limit", () => {
    const result = validateRSVPForInvitation(input({
      attendances: [{ eventId: "evening-celebration", attending: true, adults: 5, children: 0 }]
    }), { invitation: liveLikeInvitation, events });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("exceeds") });
  });

  it("does not accept an event missing from the invitation", () => {
    const result = validateRSVPForInvitation(input({
      attendances: [{ eventId: "uninvited-event", attending: true, adults: 1, children: 0 }]
    }), { invitation: liveLikeInvitation, events });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("does not include") });
  });

  it("does not accept duplicate rows for the same event", () => {
    const duplicate = [
      { eventId: "evening-celebration", attending: true, adults: 2, children: 0 },
      { eventId: "evening-celebration", attending: true, adults: 2, children: 0 }
    ];
    const result = validateRSVPForInvitation(input({ attendances: duplicate }), {
      invitation: liveLikeInvitation,
      events
    });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("only appear once") });
  });

  it("requires an answer for every celebration on an invitation", () => {
    const secondEvent: WeddingEvent = {
      ...events[0],
      id: "ceremony-two",
      title: { en: "Ceremony Two", hi: "दूसरा समारोह" }
    };
    const invitationWithTwoEvents: Invitation = {
      ...liveLikeInvitation,
      eventIds: [events[0].id, secondEvent.id],
      eventLimits: {
        ...liveLikeInvitation.eventLimits,
        [secondEvent.id]: { adults: 4, children: 2 }
      }
    };
    const result = validateRSVPForInvitation(input({
      attendances: [{ eventId: events[0].id, attending: true, adults: 2, children: 0 }]
    }), {
      invitation: invitationWithTwoEvents,
      events: [...events, secondEvent]
    });

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("every celebration") });
  });

  it("rejects unexpected fields and duplicate events at the HTTP schema boundary", () => {
    const result = rsvpSubmissionSchema.safeParse({
      ...input({ attendances: [
        { eventId: "evening-celebration", attending: true, adults: 2, children: 0 },
        { eventId: "evening-celebration", attending: true, adults: 1, children: 0 }
      ] }),
      ignored: "not accepted"
    });
    expect(result.success).toBe(false);
  });

  it("keeps a declined guest message separate from attendance comfort notes", () => {
    const declined = input({
      status: "declined",
      attendances: defaultAttendances(liveLikeInvitation),
      declineMessage: "Wishing you a beautiful celebration!"
    });
    expect(rsvpSubmissionSchema.safeParse(declined).success).toBe(true);
    expect(validateRSVPForInvitation(declined, { invitation: liveLikeInvitation, events })).toMatchObject({ ok: true });

    expect(rsvpSubmissionSchema.safeParse({
      ...input(),
      declineMessage: "This should not accompany an attending RSVP."
    }).success).toBe(false);
    expect(rsvpSubmissionSchema.safeParse({
      ...declined,
      comfortNote: "This should not accompany a declined RSVP."
    }).success).toBe(false);
  });

  it("requires at least one selected event for an attending response", () => {
    const result = validateRSVPForInvitation(input({ attendances: defaultAttendances(liveLikeInvitation) }), {
      invitation: liveLikeInvitation,
      events
    });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("at least one event") });
  });

  it("does not treat a past deadline as editable", () => {
    const result = validateRSVPForInvitation(input(), {
      invitation: { ...liveLikeInvitation, rsvpDeadlineIso: "2000-01-01T00:00:00+05:30" },
      events
    });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("closed") });
  });
});

describe("calendar output", () => {
  it("creates a UTC ICS event and escapes free text", () => {
    const event: WeddingEvent = {
      ...events[0],
      title: { en: "Dinner, dance; celebration", hi: "उत्सव" },
      practicalNote: { en: "Bring a shawl\\nSee host", hi: "" }
    };
    const calendar = createCalendarEvent(event);
    expect(calendar).toContain("BEGIN:VCALENDAR\r\n");
    expect(calendar).toContain("DTSTART:20261128T140000Z");
    expect(calendar).toContain("SUMMARY:Dinner\\, dance\\; celebration");
    expect(calendar).toContain("Bring a shawl\\\\nSee host");
  });
});
