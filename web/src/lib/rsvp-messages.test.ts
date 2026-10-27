import { describe, expect, it } from "vitest";

import { contactNumberSchema, defaultAttendances, validateRSVPForInvitation } from "@/lib/rsvp";
import { rsvpErrorMessage } from "@/lib/rsvp-messages";
import type { Invitation, Locale, RSVPInput, WeddingEvent } from "@/lib/types";

const text = { en: "Synthetic celebration", hi: "परीक्षण समारोह" };
const event: WeddingEvent = {
  id: "synthetic-event", title: text, date: text, startTime: text, arrivalWindow: text,
  startIso: "2099-12-31T12:00:00.000Z", endIso: "2099-12-31T14:00:00.000Z",
  venue: text, address: text, mapsUrl: "https://example.test/venue",
  entryNote: text, dressCode: text, practicalNote: text, category: "ceremony"
};
const invitation: Invitation = {
  token: "synthetic-invitation-token", householdName: text, preferredLocale: "en",
  eventIds: [event.id], eventLimits: { [event.id]: { adults: 2, children: 1 } },
  rsvpDeadline: text, rsvpDeadlineIso: "2099-12-31T00:00:00.000Z",
  coordinator: { role: "groom", name: "Synthetic contact", phoneDisplay: "Example phone", phoneHref: "tel:+12025550101", whatsappHref: "https://example.test/contact" }
};
const attending = { eventId: event.id, attending: true, adults: 1, children: 0 };
const input: RSVPInput = {
  token: invitation.token, respondentName: "Synthetic respondent", status: "attending", attendances: [attending]
};

describe("RSVP error messages", () => {
  const domainFailures: Array<{ name: string; input?: Partial<RSVPInput>; invitation?: Partial<Invitation> }> = [
    { name: "closed replies", invitation: { rsvpDeadlineIso: "2000-01-01T00:00:00.000Z" } },
    { name: "requests without attendance", input: { status: "confirming", comfortNote: "Synthetic request" } },
    { name: "a message on an attending reply", input: { declineMessage: "Synthetic wishes" } },
    { name: "attendance on a declined reply", input: { status: "declined" } },
    { name: "duplicate celebrations", input: { attendances: [attending, attending] } },
    { name: "an uninvited celebration", input: { attendances: [{ ...attending, eventId: "another-event" }] } },
    { name: "missing limits", invitation: { eventLimits: {} } },
    { name: "guest counts without attendance", input: { attendances: [{ ...attending, attending: false }] } },
    { name: "guest limits", input: { attendances: [{ ...attending, adults: 3 }] } },
    { name: "no guests at a selected celebration", input: { attendances: [{ ...attending, adults: 0 }] } },
    { name: "an unanswered celebration", input: { attendances: [] } },
    { name: "no selected celebration", input: { attendances: defaultAttendances(invitation) } }
  ];

  it.each(domainFailures)("localizes the actual domain failure for $name", (failure) => {
    const result = validateRSVPForInvitation({ ...input, ...failure.input }, {
      invitation: { ...invitation, ...failure.invitation }, events: [event]
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected a domain validation failure.");

    const en = rsvpErrorMessage(result.message, "en");
    const hi = rsvpErrorMessage(result.message, "hi");
    expect(en).not.toBe(rsvpErrorMessage("Unknown failure", "en"));
    expect(hi).not.toBe(rsvpErrorMessage("Unknown failure", "hi"));
    expect(en).not.toMatch(/[\u0900-\u097f]/u);
    expect(hi).toMatch(/[\u0900-\u097f]/u);
    expect(rsvpErrorMessage(en, "hi")).toBe(hi);
    expect(rsvpErrorMessage(hi, "en")).toBe(en);
  });

  it.each([
    ["Please wait a minute before trying again.", /minute/u],
    ["This invitation link is no longer active.", /new link/u],
    ["This RSVP changed in another session. Reload its latest response before saving.", /Reload/u],
    ["This request was blocked.", /reopen/u],
    ["The RSVP request is too large.", /shorten/u],
    ["Please review the RSVP details and try again.", /check/u],
    ["Enter your contact number.", /phone number/u]
  ])("keeps actionable API feedback for %s", (message, action) => {
    expect(rsvpErrorMessage(message, "en")).toMatch(action);
    expect(rsvpErrorMessage(message, "hi")).toMatch(/[\u0900-\u097f]/u);
  });

  it("localizes contact validation from the shared schema", () => {
    const result = contactNumberSchema.safeParse("invalid phone");
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected a contact validation failure.");
    expect(rsvpErrorMessage(result.error.issues[0].message, "en")).toContain("7 to 15");
    expect(rsvpErrorMessage(result.error.issues[0].message, "hi")).toContain("7 से 15");
  });

  it.each<Locale>(["en", "hi"])("keeps the localized generic fallback stable in %s", (locale) => {
    const generic = rsvpErrorMessage("Unknown failure", locale);
    expect(rsvpErrorMessage(generic, locale)).toBe(generic);
    expect(rsvpErrorMessage("We could not save your response. Please contact the coordination desk.", locale)).toBe(generic);
    expect(rsvpErrorMessage("The invitation service is temporarily unavailable.", locale)).toBe(generic);
  });

  it.each([
    "Unexpected database error in synthetic_relation",
    "Online RSVPs are now closed. Please contact the coordination desk. DETAIL: synthetic internal error",
    "Too small: expected string to have >=2 characters",
    "<script>synthetic technical detail</script>",
    ""
  ])("suppresses unknown technical details: %s", (message) => {
    for (const locale of ["en", "hi"] as const) {
      expect(rsvpErrorMessage(message, locale)).toBe(rsvpErrorMessage("Unknown failure", locale));
    }
  });
});
