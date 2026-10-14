import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./database-rsvps", () => ({ getDatabasePool: () => ({ query }) }));

import { getDatabaseWeddingIssuerOptions, loadDatabaseWeddingConfiguration } from "./database-wedding-content";

const settings = {
  couple_names_en: "Test couple", couple_names_hi: "परीक्षण युगल",
  wedding_date_en: "31 December 2099", wedding_date_hi: "31 दिसंबर 2099",
  location_en: "Test city", location_hi: "परीक्षण शहर",
  wedding_moment: "2099-12-31T18:00:00.000Z",
  rsvp_deadline: "2099-12-30T18:00:00.000Z", can_edit_until: "2099-12-29T18:00:00.000Z",
  coordinator_name: "Test desk", coordinator_phone: "+919876543210"
};
const event = {
  id: "test-event", slug: "test-event", title_en: "Test celebration", title_hi: "परीक्षण समारोह",
  date_en: "31 December", date_hi: "31 दिसंबर",
  start_time_en: "6 PM", start_time_hi: "शाम 6 बजे",
  arrival_window_en: "5 PM", arrival_window_hi: "शाम 5 बजे",
  start_at: "2099-12-31T18:00:00.000Z", end_at: "2099-12-31T21:00:00.000Z",
  venue_en: "Test venue", venue_hi: "परीक्षण स्थल", address_en: "Test address", address_hi: "परीक्षण पता",
  maps_url: "https://maps.example.test/venue", entry_note_en: "Main gate", entry_note_hi: "मुख्य द्वार",
  dress_code_en: "Festive", dress_code_hi: "उत्सव", practical_note_en: "Arrive early", practical_note_hi: "जल्दी आएँ",
  category: "celebration", published: true, display_order: 1,
  default_selected: true, default_adult_limit: 2, default_child_limit: 1
};

let settingsRows: unknown[];
let eventRows: unknown[];
let contactRows: unknown[];

describe("database wedding setup state", () => {
  beforeEach(() => {
    settingsRows = [];
    eventRows = [];
    contactRows = [];
    query.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes("from wedding.settings")) return { rows: settingsRows };
      if (sql.includes("from wedding.events")) return { rows: eventRows };
      if (sql.includes("from wedding.contacts")) return { rows: contactRows };
      throw new Error("Unexpected database query");
    });
  });

  it("returns empty coordinator options for a new database without loading sample wedding content", async () => {
    await expect(getDatabaseWeddingIssuerOptions()).resolves.toEqual({
      events: [], defaultEventLimits: [], contactOptions: [], defaultContactRole: "groom"
    });
  });

  it("keeps the configuration used by guest links and invitation issuing unavailable before setup", async () => {
    await expect(loadDatabaseWeddingConfiguration()).rejects.toThrow("Wedding settings have not been configured.");
  });

  it.each(["settings", "events", "contacts"])("propagates a %s query failure even when settings are absent", async (table) => {
    const failure = new Error("Database connection lost");
    const defaultQuery = query.getMockImplementation()!;
    query.mockImplementation((sql: string) => sql.includes(`from wedding.${table}`)
      ? Promise.reject(failure)
      : defaultQuery(sql));
    await expect(getDatabaseWeddingIssuerOptions()).rejects.toBe(failure);
  });

  it("preserves configured events, household defaults, and active contact options", async () => {
    settingsRows = [settings];
    eventRows = [event];
    contactRows = [{ role: "bride", name: "Other test desk", phone: "+919876543211", is_active: true }];
    await expect(getDatabaseWeddingIssuerOptions()).resolves.toEqual({
      events: [{ id: "test-event", title: { en: "Test celebration", hi: "परीक्षण समारोह" } }],
      defaultEventLimits: [{ eventId: "test-event", adults: 2, children: 1 }],
      contactOptions: [
        { role: "groom", name: "Test desk", phoneDisplay: "+91 98765 43210" },
        { role: "bride", name: "Other test desk", phoneDisplay: "+91 98765 43211" }
      ],
      defaultContactRole: "groom"
    });
  });

  it.each(["settings", "events", "contacts", "empty schedule"])("rejects invalid saved %s instead of treating it as new setup", async (invalidPart) => {
    settingsRows = [invalidPart === "settings" ? { ...settings, coordinator_phone: "invalid" } : settings];
    eventRows = invalidPart === "empty schedule" ? [] : [invalidPart === "events" ? { ...event, end_at: event.start_at } : event];
    contactRows = invalidPart === "contacts" ? [{ role: "bride", name: "Test", phone: "invalid", is_active: true }] : [];
    await expect(getDatabaseWeddingIssuerOptions()).rejects.toThrow("Wedding database configuration is invalid.");
  });
});
