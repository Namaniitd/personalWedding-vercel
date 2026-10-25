import { z } from "zod";

import type {
  LocalizedText,
  WeddingArtworkKey,
  WeddingDetails,
  WeddingEvent,
  WeddingEventPopupDetail,
  WeddingGuestContent,
  WeddingTravelIcon
} from "./types.js";

type DatabaseTimestamp = Date | string;

/** The selected columns shared by the hosted and direct-PostgreSQL adapters. */
export type DatabaseWeddingSettingsRow = {
  couple_names_en: string;
  couple_names_hi: string;
  wedding_date_en: string;
  wedding_date_hi: string;
  location_en: string;
  location_hi: string;
  wedding_moment: DatabaseTimestamp;
  coordinator_name: string;
  coordinator_phone: string;
  announcement_en?: string | null;
  announcement_hi?: string | null;
  announcement_starts_at?: DatabaseTimestamp | null;
  announcement_ends_at?: DatabaseTimestamp | null;
  guest_content?: unknown | null;
};

/** The selected event columns shared by the hosted and direct-PostgreSQL adapters. */
export type DatabaseWeddingEventRow = {
  id: string;
  slug: string;
  title_en: string;
  title_hi: string;
  date_en: string;
  date_hi: string;
  start_time_en: string;
  start_time_hi: string;
  arrival_window_en: string;
  arrival_window_hi: string;
  start_at: DatabaseTimestamp;
  end_at: DatabaseTimestamp;
  venue_en: string;
  venue_hi: string;
  address_en: string;
  address_hi: string;
  maps_url: string;
  entry_note_en: string;
  entry_note_hi: string;
  dress_code_en: string;
  dress_code_hi: string;
  practical_note_en: string;
  practical_note_hi: string;
  description_en?: string | null;
  description_hi?: string | null;
  popup_details?: unknown;
  category: WeddingEvent["category"];
  published: boolean;
  display_order?: number | string | null;
};

const timestampValueSchema = z.union([z.string().trim().min(1).max(100), z.date()]);
const text = (maximumLength: number) => z.string().trim().min(1).max(maximumLength);
const optionalText = (maximumLength: number) => z.string().trim().max(maximumLength).nullable().optional();

const localizedTextSchema = z.object({
  en: text(600),
  hi: text(600)
}).strict();

const popupLocalizedText = (maximumLength: number) => z.object({
  en: text(maximumLength),
  hi: text(maximumLength)
}).strict();

export const weddingEventPopupDetailsSchema = z.array(z.object({
  label: popupLocalizedText(120),
  value: popupLocalizedText(1_200)
}).strict()).max(8);

/** Discard malformed optional popup content without hiding the event itself. */
export function parseWeddingEventPopupDetails(value: unknown): WeddingEventPopupDetail[] | undefined {
  const parsed = weddingEventPopupDetailsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const artworkKeySchema = z.enum(["ganesha-basohli", "gaja-lakshmi"] satisfies WeddingArtworkKey[]);
const travelIconSchema = z.enum(["plane", "train", "car", "bed"] satisfies WeddingTravelIcon[]);

const guestContentSchema = z.object({
  hero: z.object({
    invocation: text(240).optional(),
    region: localizedTextSchema.optional(),
    invitationLead: localizedTextSchema.optional(),
    parents: z.object({
      groom: popupLocalizedText(240).optional(),
      bride: popupLocalizedText(240).optional()
    }).strict().optional(),
    artworkKey: artworkKeySchema.optional(),
    artworkAlt: localizedTextSchema.optional()
  }).strict().optional(),
  travel: z.object({
    eyebrow: localizedTextSchema.optional(),
    title: localizedTextSchema,
    lead: localizedTextSchema.optional(),
    cards: z.array(z.object({
      icon: travelIconSchema,
      title: localizedTextSchema,
      body: localizedTextSchema
    }).strict()).min(1).max(4),
    help: z.object({
      title: localizedTextSchema,
      body: localizedTextSchema
    }).strict().optional()
  }).strict().optional(),
  update: z.object({
    title: localizedTextSchema,
    body: localizedTextSchema
  }).strict().optional(),
  blessings: z.object({
    invocation: text(240).optional(),
    kicker: localizedTextSchema.optional(),
    title: localizedTextSchema,
    lead: localizedTextSchema.optional(),
    cards: z.array(z.object({
      artworkKey: artworkKeySchema,
      artworkAlt: localizedTextSchema,
      label: localizedTextSchema,
      sanskrit: text(2_400),
      translation: localizedTextSchema,
      citation: text(320)
    }).strict()).min(1).max(4)
  }).strict().optional()
}).strict();

const settingsRowSchema = z.object({
  couple_names_en: text(160),
  couple_names_hi: text(160),
  wedding_date_en: text(160),
  wedding_date_hi: text(160),
  location_en: text(200),
  location_hi: text(200),
  wedding_moment: timestampValueSchema,
  coordinator_name: text(80),
  coordinator_phone: text(40),
  announcement_en: optionalText(900),
  announcement_hi: optionalText(900),
  announcement_starts_at: timestampValueSchema.nullable().optional(),
  announcement_ends_at: timestampValueSchema.nullable().optional(),
  guest_content: z.unknown().nullable().optional()
});

function isSafeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

const eventRowSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9-]{1,100}$/),
  slug: z.string().trim().regex(/^[a-z0-9-]{1,100}$/),
  title_en: text(180),
  title_hi: text(180),
  date_en: text(180),
  date_hi: text(180),
  start_time_en: text(120),
  start_time_hi: text(120),
  arrival_window_en: text(300),
  arrival_window_hi: text(300),
  start_at: timestampValueSchema,
  end_at: timestampValueSchema,
  venue_en: text(240),
  venue_hi: text(240),
  address_en: text(600),
  address_hi: text(600),
  maps_url: text(2_000).refine(isSafeHttpsUrl, "A maps link must be a safe HTTPS URL."),
  entry_note_en: text(600),
  entry_note_hi: text(600),
  dress_code_en: text(300),
  dress_code_hi: text(300),
  practical_note_en: text(600),
  practical_note_hi: text(600),
  description_en: z.unknown().optional(),
  description_hi: z.unknown().optional(),
  popup_details: z.unknown().optional(),
  category: z.enum(["celebration", "ceremony", "reception"]),
  published: z.boolean(),
  display_order: z.union([z.number().int(), z.string().trim().regex(/^-?\d+$/)]).nullable().optional()
});

function toTimestamp(value: DatabaseTimestamp) {
  const timestamp = value instanceof Date ? value : new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp : null;
}

function toIsoTimestamp(value: DatabaseTimestamp) {
  const timestamp = toTimestamp(value);
  return timestamp ? timestamp.toISOString() : null;
}

function localized(en: string, hi: string): LocalizedText {
  return { en, hi };
}

function activeAnnouncement(
  english: string | null | undefined,
  hindi: string | null | undefined,
  startsAt: DatabaseTimestamp | null | undefined,
  endsAt: DatabaseTimestamp | null | undefined,
  now: Date
) {
  const en = english?.trim() ?? "";
  const hi = hindi?.trim() ?? "";
  // A partial translation, a malformed schedule, or a closed time window
  // should hide an optional notice—not expose stale placeholder copy.
  if (!en || !hi) return undefined;
  const start = startsAt ? toTimestamp(startsAt) : null;
  const end = endsAt ? toTimestamp(endsAt) : null;
  if ((startsAt && !start) || (endsAt && !end) || (start && end && end <= start)) return undefined;
  if ((start && now < start) || (end && now > end)) return undefined;
  return localized(en, hi);
}

/**
 * Parse optional visual copy into an intentionally small public DTO. Invalid
 * configuration is discarded wholesale, so it cannot render unvalidated
 * fields or fall back to sample wedding content.
 */
export function parseWeddingGuestContent(value: unknown): WeddingGuestContent | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = guestContentSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Map a singleton settings row without exposing its raw database shape. */
export function mapWeddingSettings(row: unknown, now = new Date()): WeddingDetails | null {
  const parsed = settingsRowSchema.safeParse(row);
  if (!parsed.success) return null;

  const weddingMoment = toIsoTimestamp(parsed.data.wedding_moment);
  if (!weddingMoment) return null;

  const announcement = activeAnnouncement(
    parsed.data.announcement_en,
    parsed.data.announcement_hi,
    parsed.data.announcement_starts_at,
    parsed.data.announcement_ends_at,
    now
  );
  const guestContent = parseWeddingGuestContent(parsed.data.guest_content);

  return {
    couple: localized(parsed.data.couple_names_en, parsed.data.couple_names_hi),
    date: localized(parsed.data.wedding_date_en, parsed.data.wedding_date_hi),
    location: localized(parsed.data.location_en, parsed.data.location_hi),
    weddingMoment,
    ...(announcement ? { announcement } : {}),
    ...(guestContent ? { guestContent } : {})
  };
}

export type MappedWeddingEvent = {
  event: WeddingEvent;
  displayOrder: number | null;
};

/**
 * Turn a narrow database row into the public event DTO. `maps_url` is checked
 * again here because values eventually become an anchor `href` in a client
 * component.
 */
export function mapWeddingEvent(row: unknown): MappedWeddingEvent | null {
  const parsed = eventRowSchema.safeParse(row);
  if (!parsed.success) return null;
  const startIso = toIsoTimestamp(parsed.data.start_at);
  const endIso = toIsoTimestamp(parsed.data.end_at);
  if (!startIso || !endIso || new Date(endIso) <= new Date(startIso)) return null;

  const displayOrder = parsed.data.display_order === null || parsed.data.display_order === undefined
    ? null
    : Number(parsed.data.display_order);
  if (displayOrder !== null && !Number.isSafeInteger(displayOrder)) return null;

  const descriptionResult = popupLocalizedText(2_400).safeParse({
    en: parsed.data.description_en,
    hi: parsed.data.description_hi
  });
  const popupDetails = parseWeddingEventPopupDetails(parsed.data.popup_details);

  return {
    event: {
      id: parsed.data.id,
      title: localized(parsed.data.title_en, parsed.data.title_hi),
      date: localized(parsed.data.date_en, parsed.data.date_hi),
      startTime: localized(parsed.data.start_time_en, parsed.data.start_time_hi),
      arrivalWindow: localized(parsed.data.arrival_window_en, parsed.data.arrival_window_hi),
      startIso,
      endIso,
      venue: localized(parsed.data.venue_en, parsed.data.venue_hi),
      address: localized(parsed.data.address_en, parsed.data.address_hi),
      mapsUrl: parsed.data.maps_url,
      entryNote: localized(parsed.data.entry_note_en, parsed.data.entry_note_hi),
      dressCode: localized(parsed.data.dress_code_en, parsed.data.dress_code_hi),
      practicalNote: localized(parsed.data.practical_note_en, parsed.data.practical_note_hi),
      ...(descriptionResult.success ? { description: descriptionResult.data } : {}),
      ...(popupDetails?.length ? { popupDetails } : {}),
      category: parsed.data.category
    },
    displayOrder
  };
}

/** A deterministic itinerary order even when a database relationship is unordered. */
export function orderWeddingEvents(events: MappedWeddingEvent[]): WeddingEvent[] {
  return [...events]
    .sort((first, second) => {
      const firstOrder = first.displayOrder ?? Number.MAX_SAFE_INTEGER;
      const secondOrder = second.displayOrder ?? Number.MAX_SAFE_INTEGER;
      return firstOrder - secondOrder
        || first.event.startIso.localeCompare(second.event.startIso)
        || first.event.id.localeCompare(second.event.id);
    })
    .map(({ event }) => event);
}

/** Format one database/hosted RSVP deadline with the same visible locale rules. */
export function formatLocalizedDate(value: DatabaseTimestamp): LocalizedText | null {
  const timestamp = toTimestamp(value);
  if (!timestamp) return null;
  const format = (locale: "en-IN" | "hi-IN") => new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata"
  }).format(timestamp);
  return { en: format("en-IN"), hi: format("hi-IN") };
}

/** Normalize a DB timestamp before it becomes part of a client-rendered DTO. */
export function normalizeDatabaseTimestamp(value: DatabaseTimestamp) {
  return toIsoTimestamp(value);
}
