import type { WeddingEvent } from "@/lib/types";

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function asUtcIcs(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function createCalendarEvent(event: WeddingEvent) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Shaadi Companion//Wedding Invitation//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@shaadi-companion`,
    `DTSTAMP:${asUtcIcs(new Date().toISOString())}`,
    `DTSTART:${asUtcIcs(event.startIso)}`,
    `DTEND:${asUtcIcs(event.endIso)}`,
    `SUMMARY:${escapeIcs(event.title.en)}`,
    `LOCATION:${escapeIcs(event.venue.en + ", " + event.address.en)}`,
    `DESCRIPTION:${escapeIcs(event.arrivalWindow.en + "\n" + event.practicalNote.en)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    ""
  ];

  return lines.join("\r\n");
}
