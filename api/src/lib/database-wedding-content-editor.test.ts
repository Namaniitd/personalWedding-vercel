import { describe, expect, it } from "vitest";

import { databaseWeddingContentEditorSchema } from "./database-wedding-content-editor";

function snapshot() {
  return {
    revision: null,
    settings: {
      coupleNamesEn: "Test couple", coupleNamesHi: "परीक्षण युगल",
      weddingDateEn: "31 December 2099", weddingDateHi: "31 दिसंबर 2099",
      locationEn: "Test city", locationHi: "परीक्षण शहर",
      weddingMoment: "2099-12-31T18:00:00.000Z",
      rsvpDeadline: "2099-12-30T18:00:00.000Z", canEditUntil: "2099-12-29T18:00:00.000Z",
      coordinatorName: "Test desk", coordinatorPhone: "+919876543210",
      announcementEn: "", announcementHi: "", announcementStartsAt: null, announcementEndsAt: null,
      guestContent: null
    },
    events: [{
      id: "test-event", slug: "test-event", titleEn: "Test celebration", titleHi: "परीक्षण समारोह",
      dateEn: "31 December", dateHi: "31 दिसंबर", startTimeEn: "6 PM", startTimeHi: "शाम 6 बजे",
      arrivalWindowEn: "5 PM", arrivalWindowHi: "शाम 5 बजे",
      startAt: "2099-12-31T18:00:00.000Z", endAt: "2099-12-31T21:00:00.000Z",
      venueEn: "Test venue", venueHi: "परीक्षण स्थल", addressEn: "Test address", addressHi: "परीक्षण पता",
      mapsUrl: "https://maps.example.test/venue", entryNoteEn: "Main gate", entryNoteHi: "मुख्य द्वार",
      dressCodeEn: "Festive", dressCodeHi: "उत्सव", practicalNoteEn: "Arrive early", practicalNoteHi: "जल्दी आएँ",
      category: "celebration", published: true, displayOrder: 1,
      defaultSelected: true, defaultAdultLimit: 2, defaultChildLimit: 1
    }],
    contacts: []
  };
}

const popupField = {
  label: { en: "A custom question", hi: "अपना प्रश्न" },
  value: { en: "Our own event information", hi: "हमारे कार्यक्रम की जानकारी" }
};

function withPopup(fields: unknown[], descriptionEn = "", descriptionHi = "") {
  const input = snapshot();
  return { ...input, events: [{ ...input.events[0], descriptionEn, descriptionHi, popupDetails: fields }] };
}

describe("coordinator event popup validation", () => {
  it("keeps older editor submissions valid and defaults optional event popup content", () => {
    const parsed = databaseWeddingContentEditorSchema.parse(snapshot());
    expect(parsed.events[0]).toMatchObject({ descriptionEn: "", descriptionHi: "", popupDetails: [] });
  });

  it("accepts fully custom bilingual field names and preserves field order", () => {
    const second = { label: { en: "A second custom label", hi: "दूसरा शीर्षक" }, value: { en: "Second answer", hi: "दूसरा उत्तर" } };
    const parsed = databaseWeddingContentEditorSchema.parse(withPopup([popupField, second], "Introduction", "परिचय"));
    expect(parsed.events[0].popupDetails).toEqual([popupField, second]);
    expect(parsed.events[0].descriptionEn).toBe("Introduction");
  });

  it("requires a complete translation when a description is supplied", () => {
    expect(databaseWeddingContentEditorSchema.safeParse(withPopup([], "Introduction", "")).success).toBe(false);
    expect(databaseWeddingContentEditorSchema.safeParse(withPopup([], "", "परिचय")).success).toBe(false);
    expect(databaseWeddingContentEditorSchema.safeParse(withPopup([], "a".repeat(2_401), "परिचय")).success).toBe(false);
  });

  it("rejects incomplete, unbounded and arbitrary popup payloads", () => {
    const invalidFields = [
      Array.from({ length: 9 }, () => popupField),
      [{ ...popupField, label: { en: "", hi: "शीर्षक" } }],
      [{ ...popupField, value: { en: "Text", hi: "" } }],
      [{ ...popupField, label: { en: "a".repeat(121), hi: "शीर्षक" } }],
      [{ ...popupField, value: { en: "a".repeat(1_201), hi: "पाठ" } }],
      [{ ...popupField, html: "<script>unexpected()</script>" }],
      [{ ...popupField, label: { ...popupField.label, url: "https://unexpected.example" } }]
    ];
    for (const fields of invalidFields) {
      expect(databaseWeddingContentEditorSchema.safeParse(withPopup(fields)).success).toBe(false);
    }
  });
});

describe("coordinator invitation lead validation", () => {
  function withInvitationLead(invitationLead: unknown) {
    const input = snapshot();
    return { ...input, settings: { ...input.settings, guestContent: { hero: { invitationLead } } } };
  }

  it("accepts bilingual invitation copy in the existing guest content document", () => {
    const invitationLead = { en: "Join our family celebration.", hi: "हमारे पारिवारिक उत्सव में शामिल हों।" };
    const parsed = databaseWeddingContentEditorSchema.parse(withInvitationLead(invitationLead));
    expect(parsed.settings.guestContent).toEqual({ hero: { invitationLead } });
  });

  it("rejects editor saves with incomplete or overlong invitation copy", () => {
    for (const invitationLead of [
      { en: "English only" },
      { en: "Join us.", hi: "" },
      { en: "a".repeat(601), hi: "आमंत्रण" },
      { en: "Join us.", hi: "अ".repeat(601) }
    ]) {
      const parsed = databaseWeddingContentEditorSchema.safeParse(withInvitationLead(invitationLead));
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues).toContainEqual(expect.objectContaining({ path: ["settings", "guestContent"] }));
    }
  });
});

describe("coordinator parents validation", () => {
  it("accepts optional parents through the existing content save contract", () => {
    const input = snapshot();
    const parents = { groom: { en: "Groom's family", hi: "वर का परिवार" } };
    const guestContent = { hero: { parents } };
    expect(databaseWeddingContentEditorSchema.parse({ ...input, settings: { ...input.settings, guestContent } }).settings.guestContent).toEqual(guestContent);
  });

  it("rejects a save with incomplete parents translations", () => {
    const input = snapshot();
    const guestContent = { hero: { parents: { bride: { en: "Bride's family" } } } };
    expect(databaseWeddingContentEditorSchema.safeParse({ ...input, settings: { ...input.settings, guestContent } }).success).toBe(false);
  });
});
