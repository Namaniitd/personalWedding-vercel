import { describe, expect, it } from "vitest";

import {
  mapWeddingEvent,
  mapWeddingSettings,
  orderWeddingEvents,
  parseWeddingGuestContent
} from "./wedding-content";

const settingsRow = {
  couple_names_en: "Couple",
  couple_names_hi: "युगल",
  wedding_date_en: "Wedding date",
  wedding_date_hi: "विवाह तिथि",
  location_en: "Wedding location",
  location_hi: "विवाह स्थल",
  wedding_moment: "2030-12-31T18:00:00.000Z",
  coordinator_name: "Coordination desk",
  coordinator_phone: "+919876543210",
  announcement_en: "A reviewed update",
  announcement_hi: "समीक्षित सूचना",
  announcement_starts_at: "2029-01-01T00:00:00.000Z",
  announcement_ends_at: "2031-01-01T00:00:00.000Z"
};

const eventRow = {
  id: "celebration-one",
  slug: "celebration-one",
  title_en: "Celebration",
  title_hi: "समारोह",
  date_en: "Wedding date",
  date_hi: "विवाह तिथि",
  start_time_en: "7:00 PM",
  start_time_hi: "शाम 7:00 बजे",
  arrival_window_en: "Arrival window",
  arrival_window_hi: "आगमन समय",
  start_at: "2030-12-31T18:00:00.000Z",
  end_at: "2030-12-31T21:00:00.000Z",
  venue_en: "Wedding venue",
  venue_hi: "विवाह स्थल",
  address_en: "Venue address",
  address_hi: "स्थल का पता",
  maps_url: "https://maps.example/venue",
  entry_note_en: "Entry note",
  entry_note_hi: "प्रवेश सूचना",
  dress_code_en: "Festive",
  dress_code_hi: "उत्सव परिधान",
  practical_note_en: "Practical note",
  practical_note_hi: "व्यावहारिक सूचना",
  category: "celebration" as const,
  published: true,
  display_order: 2
};

describe("database wedding content mapping", () => {
  it("maps reviewed settings and only renders an announcement in its active window", () => {
    const mapped = mapWeddingSettings(settingsRow, new Date("2030-06-01T00:00:00.000Z"));
    expect(mapped).toMatchObject({
      couple: { en: "Couple", hi: "युगल" },
      announcement: { en: "A reviewed update", hi: "समीक्षित सूचना" }
    });

    const expired = mapWeddingSettings(settingsRow, new Date("2032-01-01T00:00:00.000Z"));
    expect(expired?.announcement).toBeUndefined();
  });

  it("accepts only code-owned visual keys and bounded text in database guest content", () => {
    const guestContent = {
      hero: {
        invocation: "शुभारम्भ",
        region: { en: "A family celebration", hi: "पारिवारिक उत्सव" },
        artworkKey: "ganesha-basohli",
        artworkAlt: { en: "Ganesha artwork", hi: "गणेश कला" }
      },
      travel: {
        title: { en: "Travel", hi: "यात्रा" },
        cards: [{
          icon: "train",
          title: { en: "Rail", hi: "रेल" },
          body: { en: "Reviewed travel details", hi: "समीक्षित यात्रा विवरण" }
        }]
      },
      blessings: {
        title: { en: "Blessings", hi: "आशीर्वाद" },
        cards: [{
          artworkKey: "gaja-lakshmi",
          artworkAlt: { en: "Lakshmi artwork", hi: "लक्ष्मी कला" },
          label: { en: "Blessing", hi: "आशीर्वाद" },
          sanskrit: "सर्वे भवन्तु सुखिनः",
          translation: { en: "May all be happy.", hi: "सभी सुखी हों।" },
          citation: "Reviewed citation"
        }]
      }
    };

    expect(parseWeddingGuestContent(guestContent)).toEqual(guestContent);
    expect(mapWeddingSettings({ ...settingsRow, guest_content: guestContent })?.guestContent).toEqual(guestContent);

    expect(parseWeddingGuestContent({
      hero: {
        artworkKey: "https://untrusted.example/image.jpg",
        artworkAlt: { en: "Unexpected", hi: "अप्रत्याशित" }
      }
    })).toBeUndefined();
    expect(parseWeddingGuestContent({
      update: {
        title: { en: "Update", hi: "सूचना" },
        body: { en: "Text", hi: "पाठ" },
        html: "<script>alert(1)</script>"
      }
    })).toBeUndefined();
  });

  it("maps an optional bilingual invitation lead and trims its text", () => {
    const guestContent = { hero: { invitationLead: { en: "  Join our celebration.  ", hi: "  हमारे उत्सव में शामिल हों।  " } } };
    const expected = { hero: { invitationLead: { en: "Join our celebration.", hi: "हमारे उत्सव में शामिल हों।" } } };
    expect(parseWeddingGuestContent(guestContent)).toEqual(expected);
    expect(mapWeddingSettings({ ...settingsRow, guest_content: guestContent })?.guestContent).toEqual(expected);

    const maximum = { hero: { invitationLead: { en: "a".repeat(600), hi: "अ".repeat(600) } } };
    expect(parseWeddingGuestContent(maximum)).toEqual(maximum);
    expect(parseWeddingGuestContent({ hero: {} })).toEqual({ hero: {} });
  });

  it("rejects incomplete, malformed and overlong invitation lead translations", () => {
    const invalidLeads = [
      "Join us.",
      null,
      { en: "Join us." },
      { en: "Join us.", hi: "" },
      { en: "   ", hi: "आमंत्रण" },
      { en: 42, hi: "आमंत्रण" },
      { en: "Join us.", hi: "आमंत्रण", html: "<b>Unexpected</b>" },
      { en: "a".repeat(601), hi: "आमंत्रण" },
      { en: "Join us.", hi: "अ".repeat(601) }
    ];
    for (const invitationLead of invalidLeads) {
      expect(parseWeddingGuestContent({ hero: { invitationLead } })).toBeUndefined();
    }
  });

  it("maps optional bilingual parents without requiring either family on older invitations", () => {
    const parents = {
      groom: { en: "  Groom's family  ", hi: "  वर का परिवार  " },
      bride: { en: "Bride's family", hi: "वधू का परिवार" }
    };
    const expected = { groom: { en: "Groom's family", hi: "वर का परिवार" }, bride: parents.bride };
    const content = { hero: { parents } };
    expect(parseWeddingGuestContent(content)?.hero?.parents).toEqual(expected);
    expect(mapWeddingSettings({ ...settingsRow, guest_content: content })?.guestContent?.hero?.parents).toEqual(expected);
    expect(parseWeddingGuestContent({ hero: { parents: { groom: expected.groom } } })?.hero?.parents).toEqual({ groom: expected.groom });
    expect(parseWeddingGuestContent({ hero: {} })).toEqual({ hero: {} });
  });

  it("rejects malformed or unbounded parents content", () => {
    for (const parents of [
      null,
      "Names",
      { groom: { en: "Family" } },
      { bride: { en: "Family", hi: " " } },
      { groom: { en: "a".repeat(241), hi: "परिवार" } },
      { groom: { en: "Family", hi: "परिवार", image: "https://unexpected.example" } },
      { other: { en: "Family", hi: "परिवार" } }
    ]) {
      expect(parseWeddingGuestContent({ hero: { parents } })).toBeUndefined();
    }
  });

  it("rejects unsafe event rows and orders valid database events deterministically", () => {
    const mapped = mapWeddingEvent(eventRow);
    expect(mapped?.event.mapsUrl).toBe("https://maps.example/venue");
    expect(mapWeddingEvent({ ...eventRow, maps_url: "javascript:alert(1)" })).toBeNull();
    expect(mapWeddingEvent({ ...eventRow, end_at: eventRow.start_at })).toBeNull();

    const earlier = mapWeddingEvent({
      ...eventRow,
      id: "celebration-two",
      slug: "celebration-two",
      start_at: "2030-12-30T18:00:00.000Z",
      end_at: "2030-12-30T21:00:00.000Z",
      display_order: 1
    });
    if (!mapped || !earlier) throw new Error("Test event rows must map.");
    expect(orderWeddingEvents([mapped, earlier]).map((event) => event.id))
      .toEqual(["celebration-two", "celebration-one"]);
  });

  it("maps bilingual event descriptions and custom popup fields in their saved order", () => {
    const popupDetails = [
      { label: { en: "Shuttle", hi: "शटल" }, value: { en: "Meet at the main gate.", hi: "मुख्य द्वार पर मिलें।" } },
      { label: { en: "Family tradition", hi: "पारिवारिक परंपरा" }, value: { en: "Bring your blessings.", hi: "अपना आशीर्वाद दें।" } }
    ];
    expect(mapWeddingEvent({
      ...eventRow,
      description_en: "  Join our celebration.  ",
      description_hi: "  हमारे समारोह में शामिल हों।  ",
      popup_details: popupDetails
    })?.event).toMatchObject({
      description: { en: "Join our celebration.", hi: "हमारे समारोह में शामिल हों।" },
      popupDetails
    });
  });

  it("keeps valid event logistics when optional descriptions or popup fields are malformed", () => {
    const cases = [
      { description_en: "English only", description_hi: "" },
      { description_en: "a".repeat(2_401), description_hi: "विवरण" },
      { description_en: { html: "Unexpected" }, description_hi: "विवरण" },
      { popup_details: [{ label: { en: "Parking", hi: "पार्किंग" }, value: { en: "Main gate", hi: "मुख्य द्वार" }, html: "<script>unexpected()</script>" }] },
      { popup_details: [{ label: { en: "Parking", hi: "" }, value: { en: "Main gate", hi: "मुख्य द्वार" } }] },
      { popup_details: Array.from({ length: 9 }, () => ({ label: { en: "Label", hi: "शीर्षक" }, value: { en: "Text", hi: "पाठ" } })) }
    ];
    for (const optionalContent of cases) {
      const event = mapWeddingEvent({ ...eventRow, ...optionalContent })?.event;
      expect(event?.id).toBe(eventRow.id);
      expect(event?.description).toBeUndefined();
      expect(event?.popupDetails).toBeUndefined();
    }
  });
});
