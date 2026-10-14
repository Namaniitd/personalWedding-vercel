import { describe, expect, it } from "vitest";

import { createCalendarEvent } from "@/lib/calendar";
import type { WeddingEvent } from "@/lib/types";

describe("calendar downloads", () => {
  it("keeps the correct UTC moment and a single escaped description newline", () => {
    const text = { en: "Example", hi: "उदाहरण" };
    const event: WeddingEvent = { id: "ceremony", title: text, date: text, startTime: text, arrivalWindow: { en: "Arrive at 11:45", hi: "11:45" },
      startIso: "2026-12-01T12:00:00+05:30", endIso: "2026-12-01T14:00:00+05:30", venue: text, address: text,
      mapsUrl: "https://maps.google.com/", entryNote: text, dressCode: text, practicalNote: { en: "Bring your invitation", hi: "निमंत्रण" }, category: "ceremony" };
    const calendar = createCalendarEvent(event);
    expect(calendar).toContain("DTSTART:20261201T063000Z\r\n");
    expect(calendar).toContain("DESCRIPTION:Arrive at 11:45\\nBring your invitation\r\n");
    expect(calendar).not.toContain("DESCRIPTION:Arrive at 11:45\\\\n");
  });
});
