import { describe, expect, it } from "vitest";

import { createCalendarEvent } from "./calendar";
import type { WeddingEvent } from "./types";

describe("calendar text", () => {
  it("encodes a real description newline once and prevents carriage-return property injection", () => {
    const event = {
      id: "test-event", startIso: "2099-01-01T12:00:00Z", endIso: "2099-01-01T13:00:00Z",
      title: { en: "Celebration\rInjected: value" }, venue: { en: "Venue" }, address: { en: "Address" },
      arrivalWindow: { en: "Arrive early" }, practicalNote: { en: "Wear festive clothes" }
    } as WeddingEvent;
    const output = createCalendarEvent(event);
    expect(output).toContain("DESCRIPTION:Arrive early\\nWear festive clothes\r\n");
    expect(output).not.toContain("DESCRIPTION:Arrive early\\\\n");
    expect(output).toContain("SUMMARY:Celebration\\nInjected: value\r\n");
  });
});
