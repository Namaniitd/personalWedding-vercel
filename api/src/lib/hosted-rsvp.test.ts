import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveInvitation } from "./invitations";

const settings = {
  couple_names_en: "Test Couple", couple_names_hi: "परीक्षण युगल", wedding_date_en: "Wedding date", wedding_date_hi: "विवाह तिथि",
  location_en: "Test venue", location_hi: "परीक्षण स्थल", wedding_moment: "2099-01-01T18:00:00Z",
  coordinator_name: "Test Desk", coordinator_phone: "9876543210"
};
const event = {
  id: "test-event", slug: "test-event", title_en: "Celebration", title_hi: "समारोह", date_en: "Wedding date", date_hi: "विवाह तिथि",
  start_time_en: "7 PM", start_time_hi: "7 बजे", arrival_window_en: "Arrive early", arrival_window_hi: "जल्दी आएँ",
  start_at: "2099-01-01T18:00:00Z", end_at: "2099-01-01T21:00:00Z", venue_en: "Venue", venue_hi: "स्थल",
  address_en: "Address", address_hi: "पता", maps_url: "https://maps.example.test/venue", entry_note_en: "Entry", entry_note_hi: "प्रवेश",
  dress_code_en: "Festive", dress_code_hi: "उत्सव", practical_note_en: "Note", practical_note_hi: "सूचना", category: "celebration", published: true, display_order: 1
};

describe("hosted returning RSVP", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("restores saved names, counts and notes from the same invitation instead of a blank form", async () => {
    for (const key of ["DATABASE_URL", "DATABASE_INVITATION_TOKEN_PEPPER", "DATABASE_ENTRY_PASS_TOKEN_PEPPER"]) vi.stubEnv(key, "");
    vi.stubEnv("SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-role-key");
    vi.stubEnv("INVITATION_TOKEN_PEPPER", "synthetic-invitation-pepper");
    vi.stubEnv("ENTRY_PASS_TOKEN_PEPPER", "synthetic-entry-pepper");
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith("/wedding_settings")) return Response.json(settings);
      if (parsed.pathname.endsWith("/invitations")) return Response.json({
        id: "3810429c-b718-4ff8-b9bd-b6df41d85f1b", household_name_en: "Test household", household_name_hi: "परीक्षण परिवार", preferred_locale: "en",
        rsvp_deadline: "2098-12-31T23:59:59Z", can_edit_until: "2098-12-31T23:59:59Z",
        invitation_events: [{ adult_limit: 2, child_limit: 1, event }]
      });
      expect(parsed.pathname).toBe("/rest/v1/rsvps");
      expect(parsed.searchParams.get("invitation_id")).toBe("eq.3810429c-b718-4ff8-b9bd-b6df41d85f1b");
      return Response.json({ respondent_name: "Returning Guest", status: "attending", comfort_note: "Vegetarian", decline_message: null,
        updated_at: "2098-12-30T10:00:00.123456Z", rsvp_event_attendance: [{ event_id: "test-event", is_attending: true, adult_count: 2, child_count: 1 }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const token = "synthetic-returning-household-token";
    expect((await resolveInvitation(token))?.rsvp).toEqual({ token, respondentName: "Returning Guest", status: "attending", comfortNote: "Vegetarian", declineMessage: undefined,
      attendances: [{ eventId: "test-event", attending: true, adults: 2, children: 1 }], updatedAt: "2098-12-30T10:00:00.123Z" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
