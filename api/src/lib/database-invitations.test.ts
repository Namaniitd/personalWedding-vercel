import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDatabaseWeddingIssuerOptions, loadDatabaseWeddingConfiguration } = vi.hoisted(() => ({
  getDatabaseWeddingIssuerOptions: vi.fn(),
  loadDatabaseWeddingConfiguration: vi.fn()
}));

vi.mock("./database-wedding-content", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./database-wedding-content")>();
  return { ...actual, getDatabaseWeddingIssuerOptions, loadDatabaseWeddingConfiguration };
});

import {
  databaseInvitationIssueSchema,
  getDatabaseInvitationIssuerOptions,
  validateDatabaseInvitationContactRole,
  validateDatabaseInvitationIssue
} from "./database-invitations";
import type { DatabaseInvitationIssuerOptions } from "../domain/types";

const validIssue = {
  householdNameEn: "Test household",
  householdNameHi: "",
  preferredLocale: "en" as const,
  eventLimits: [
    { eventId: "celebration-one", adults: 2, children: 1 },
    { eventId: "ceremony-one", adults: 2, children: 1 }
  ]
};

const issuerOptions: DatabaseInvitationIssuerOptions = {
  events: [
    { id: "celebration-one", title: { en: "Celebration", hi: "समारोह" } },
    { id: "ceremony-one", title: { en: "Ceremony", hi: "विवाह समारोह" } }
  ],
  defaultEventLimits: [{ eventId: "celebration-one", adults: 2, children: 1 }],
  contactOptions: [{ role: "groom", name: "Coordination desk", phoneDisplay: "+91 98765 43210" }],
  defaultContactRole: "groom"
};

const databaseConfiguration = {
  wedding: {
    couple: { en: "Couple", hi: "युगल" },
    date: { en: "Wedding date", hi: "विवाह तिथि" },
    location: { en: "Wedding location", hi: "विवाह स्थल" },
    weddingMoment: "2099-12-31T18:00:00.000Z"
  },
  rsvpDeadline: { en: "31 December 2099", hi: "31 दिसंबर 2099" },
  rsvpDeadlineAt: "2099-12-31T23:59:59.000Z",
  rsvpDeadlineIso: "2099-12-31T23:59:59.000Z",
  events: issuerOptions.events.map((event, index) => ({
    event: {
      id: event.id,
      title: event.title,
      date: { en: "Wedding date", hi: "विवाह तिथि" },
      startTime: { en: "7:00 PM", hi: "शाम 7:00 बजे" },
      arrivalWindow: { en: "Arrival window", hi: "आगमन समय" },
      startIso: `2099-12-3${index}T18:00:00.000Z`,
      endIso: `2099-12-3${index}T21:00:00.000Z`,
      venue: { en: "Wedding venue", hi: "विवाह स्थल" },
      address: { en: "Venue address", hi: "स्थल का पता" },
      mapsUrl: "https://maps.example/venue",
      entryNote: { en: "Entry note", hi: "प्रवेश सूचना" },
      dressCode: { en: "Festive", hi: "उत्सव परिधान" },
      practicalNote: { en: "Practical note", hi: "व्यावहारिक सूचना" },
      category: index === 0 ? "celebration" as const : "ceremony" as const
    },
    defaultSelected: index === 0,
    defaultAdults: 2,
    defaultChildren: 1
  })),
  contacts: {
    groom: {
      role: "groom" as const,
      name: "Coordination desk",
      phoneDisplay: "+91 98765 43210",
      phoneHref: "tel:+919876543210",
      whatsappHref: "https://wa.me/919876543210"
    }
  }
};

describe("database invitation issue validation", () => {
  beforeEach(() => {
    loadDatabaseWeddingConfiguration.mockReset();
    getDatabaseWeddingIssuerOptions.mockReset();
    loadDatabaseWeddingConfiguration.mockResolvedValue(databaseConfiguration);
    getDatabaseWeddingIssuerOptions.mockResolvedValue(issuerOptions);
  });

  it("uses a supplied name as the safe English/Hindi fallback", async () => {
    const parsed = databaseInvitationIssueSchema.safeParse(validIssue);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    await expect(validateDatabaseInvitationIssue(parsed.data)).resolves.toEqual({
      ok: true,
      value: {
        ...validIssue,
        householdNameHi: "Test household",
        contactRole: "groom"
      }
    });
  });

  it("accepts optional phone formatting and rejects incomplete or unsafe contacts", async () => {
    const contactNumber = "+91 (98765) 43210";
    const parsed = databaseInvitationIssueSchema.parse({ ...validIssue, contactNumber: ` ${contactNumber} ` });
    await expect(validateDatabaseInvitationIssue(parsed)).resolves.toMatchObject({ ok: true, value: { contactNumber } });
    expect(databaseInvitationIssueSchema.safeParse({ ...validIssue, contactNumber: "" }).success).toBe(true);
    for (const contactNumber of ["12345", "+1234567890123456", "guest@example.com", "91+9876543210", "1234567 ext 9"]) {
      expect(databaseInvitationIssueSchema.safeParse({ ...validIssue, contactNumber }).success).toBe(false);
    }
  });

  it("requires one valid household name even though either locale is optional", async () => {
    expect(databaseInvitationIssueSchema.safeParse({ ...validIssue, householdNameEn: "", householdNameHi: "" }).success).toBe(false);
    expect(databaseInvitationIssueSchema.safeParse({ ...validIssue, householdNameEn: "A" }).success).toBe(false);

    const hindiOnly = databaseInvitationIssueSchema.safeParse({
      ...validIssue,
      householdNameEn: "",
      householdNameHi: "परीक्षण परिवार",
      preferredLocale: "hi"
    });
    expect(hindiOnly.success).toBe(true);
    if (!hindiOnly.success) return;
    await expect(validateDatabaseInvitationIssue(hindiOnly.data)).resolves.toMatchObject({
      ok: true,
      value: { householdNameEn: "परीक्षण परिवार", householdNameHi: "परीक्षण परिवार", preferredLocale: "hi" }
    });
  });

  it("validates selected celebrations against the current database configuration", async () => {
    const unknown = databaseInvitationIssueSchema.parse({
      ...validIssue,
      eventLimits: [{ eventId: "unknown-event", adults: 2, children: 0 }]
    });
    await expect(validateDatabaseInvitationIssue(unknown)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("not available")
    });

    const duplicate = databaseInvitationIssueSchema.parse({
      ...validIssue,
      eventLimits: [
        { eventId: "celebration-one", adults: 2, children: 0 },
        { eventId: "celebration-one", adults: 1, children: 0 }
      ]
    });
    await expect(validateDatabaseInvitationIssue(duplicate)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("only be selected once")
    });

    const emptyLimit = databaseInvitationIssueSchema.parse({
      ...validIssue,
      eventLimits: [{ eventId: "celebration-one", adults: 0, children: 0 }]
    });
    await expect(validateDatabaseInvitationIssue(emptyLimit)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("at least one guest")
    });
  });

  it("uses database-backed coordinator defaults and rejects an unavailable reply-to role", async () => {
    await expect(getDatabaseInvitationIssuerOptions()).resolves.toEqual(issuerOptions);
    expect(getDatabaseWeddingIssuerOptions).toHaveBeenCalledTimes(1);

    await expect(validateDatabaseInvitationContactRole("groom")).resolves.toEqual({ ok: true });
    await expect(validateDatabaseInvitationContactRole("bride")).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("bride")
    });
  });
});
