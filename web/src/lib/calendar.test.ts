import { describe, expect, it } from "vitest";

import { createCalendarEvent } from "@/lib/calendar";
import type { WeddingEvent } from "@/lib/types";

const text = { en: "Example", hi: "उदाहरण" };
const event: WeddingEvent = { id: "ceremony", title: text, date: text, startTime: text, arrivalWindow: { en: "Arrive at 11:45", hi: "सुबह 11:45 बजे पहुँचें" },
  startIso: "2026-12-01T12:00:00+05:30", endIso: "2026-12-01T14:00:00+05:30", venue: text, address: text,
  mapsUrl: "https://maps.google.com/", entryNote: text, dressCode: text, practicalNote: { en: "Bring your invitation", hi: "निमंत्रण साथ लाएँ" }, category: "ceremony" };

describe("calendar downloads", () => {
  it("defaults to English and keeps the correct UTC moment and description escaping", () => {
    const calendar = createCalendarEvent(event);
    expect(calendar).toContain("SUMMARY:Example\r\n");
    expect(createCalendarEvent(event, "en")).toContain("SUMMARY:Example\r\n");
    expect(calendar).toContain("DTSTART:20261201T063000Z\r\n");
    expect(calendar).toContain("DESCRIPTION:Arrive at 11:45\\nBring your invitation\r\n");
    expect(calendar).not.toContain("DESCRIPTION:Arrive at 11:45\\\\n");
  });

  it("uses Hindi for every displayed field while preserving calendar identity, time and escaping", () => {
    const calendar = createCalendarEvent({
      ...event,
      title: { en: "Celebration", hi: "विवाह, मिलन; उत्सव" },
      venue: { en: "Garden", hi: "उद्यान, भवन" },
      address: { en: "Main street", hi: "मुख्य मार्ग; शहर" },
      practicalNote: { en: "Bring your invitation", hi: "निमंत्रण साथ लाएँ\nमेज़बान से मिलें" }
    }, "hi");

    expect(calendar).toContain("UID:ceremony@shaadi-companion\r\n");
    expect(calendar).toContain("DTSTART:20261201T063000Z\r\n");
    expect(calendar).toContain("DTEND:20261201T083000Z\r\n");
    expect(calendar).toContain("SUMMARY:विवाह\\, मिलन\\; उत्सव\r\n");
    expect(calendar).toContain("LOCATION:उद्यान\\, भवन\\, मुख्य मार्ग\\; शहर\r\n");
    expect(calendar).toContain("DESCRIPTION:सुबह 11:45 बजे पहुँचें\\nनिमंत्रण साथ लाएँ\\nमेज़बान से मिलें\r\n");
    expect(calendar).not.toContain("Arrive at 11:45");
  });
});
