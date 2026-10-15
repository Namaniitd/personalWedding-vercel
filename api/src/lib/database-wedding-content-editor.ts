import { createHash } from "node:crypto";

import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import { createWeddingContact } from "../domain/wedding-contact.js";
import { lockDatabaseContentAndInvitationIssue } from "./database-content-lock.js";
import { getDatabasePool } from "./database-rsvps.js";
import { requireWeddingSide, weddingSideSettingsId } from "../domain/wedding-side.js";
import {
  mapWeddingEvent,
  normalizeDatabaseTimestamp,
  parseWeddingGuestContent,
  parseWeddingEventPopupDetails,
  weddingEventPopupDetailsSchema
} from "../domain/wedding-content.js";
import type {
  ContactRole,
  DatabaseWeddingContentContact,
  DatabaseWeddingContentEvent,
  DatabaseWeddingContentSettings,
  DatabaseWeddingContentSnapshot,
  WeddingGuestContent,
  WeddingSide
} from "../domain/types.js";

type DatabaseEditorSettingsRow = {
  couple_names_en: string;
  couple_names_hi: string;
  wedding_date_en: string;
  wedding_date_hi: string;
  location_en: string;
  location_hi: string;
  wedding_moment: Date | string;
  rsvp_deadline: Date | string;
  can_edit_until: Date | string;
  coordinator_name: string;
  coordinator_phone: string;
  announcement_en: string | null;
  announcement_hi: string | null;
  announcement_starts_at: Date | string | null;
  announcement_ends_at: Date | string | null;
  guest_content: unknown | null;
};

type DatabaseEditorEventRow = {
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
  start_at: Date | string;
  end_at: Date | string;
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
  description_en: string;
  description_hi: string;
  popup_details: unknown;
  category: "celebration" | "ceremony" | "reception";
  published: boolean;
  display_order: number | string;
  default_selected: boolean;
  default_adult_limit: number | string;
  default_child_limit: number | string;
};

type DatabaseEditorContactRow = {
  role: ContactRole;
  name: string;
  phone: string;
  is_active: boolean;
};

type ActiveInvitationReferenceRow = {
  contact_role: ContactRole;
  event_limits: unknown;
  access_expires_at: Date | string;
};

type DatabaseQueryable = Pool | PoolClient;

const EVENT_IDENTIFIER = /^[a-z0-9-]{1,100}$/;
const REVISION = /^[a-f0-9]{64}$/;
const MAX_EDITOR_EVENTS = 50;
const MAX_EDITOR_CONTACTS = 2;

const requiredText = (maximumLength: number) => z.string().trim().min(1).max(maximumLength);
const optionalText = (maximumLength: number) => z.string().trim().max(maximumLength);
const timestamp = z.string().trim().min(1).max(100).refine((value) => (
  // The editor presents every time in IST. Requiring a zone here means a
  // programmatic caller cannot reinterpret a wall-clock timestamp in the
  // server's timezone (or a coordinator's browser timezone).
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value))
), {
  message: "Enter a valid date and time with a timezone."
});
const nullableTimestamp = z.union([timestamp, z.null()]);

const settingsInputSchema = z.object({
  coupleNamesEn: requiredText(160),
  coupleNamesHi: requiredText(160),
  weddingDateEn: requiredText(160),
  weddingDateHi: requiredText(160),
  locationEn: requiredText(200),
  locationHi: requiredText(200),
  weddingMoment: timestamp,
  rsvpDeadline: timestamp,
  canEditUntil: timestamp,
  coordinatorName: requiredText(80),
  coordinatorPhone: requiredText(40),
  announcementEn: optionalText(900),
  announcementHi: optionalText(900),
  announcementStartsAt: nullableTimestamp,
  announcementEndsAt: nullableTimestamp,
  // JSONB in the database is an object or null. The strict public-content
  // schema is applied below; this only ensures a browser cannot send a scalar.
  guestContent: z.union([z.record(z.string(), z.unknown()), z.null()])
}).strict();

const eventInputSchema = z.object({
  id: z.string().trim().regex(EVENT_IDENTIFIER),
  slug: z.string().trim().regex(EVENT_IDENTIFIER),
  titleEn: requiredText(180),
  titleHi: requiredText(180),
  dateEn: requiredText(180),
  dateHi: requiredText(180),
  startTimeEn: requiredText(120),
  startTimeHi: requiredText(120),
  arrivalWindowEn: requiredText(300),
  arrivalWindowHi: requiredText(300),
  startAt: timestamp,
  endAt: timestamp,
  venueEn: requiredText(240),
  venueHi: requiredText(240),
  addressEn: requiredText(600),
  addressHi: requiredText(600),
  mapsUrl: requiredText(2_000),
  entryNoteEn: requiredText(600),
  entryNoteHi: requiredText(600),
  dressCodeEn: requiredText(300),
  dressCodeHi: requiredText(300),
  practicalNoteEn: requiredText(600),
  practicalNoteHi: requiredText(600),
  descriptionEn: optionalText(2_400).default(""),
  descriptionHi: optionalText(2_400).default(""),
  popupDetails: weddingEventPopupDetailsSchema.default([]),
  category: z.enum(["celebration", "ceremony", "reception"]),
  published: z.boolean(),
  displayOrder: z.number().int().min(-32_768).max(32_767),
  defaultSelected: z.boolean(),
  defaultAdultLimit: z.number().int().min(0).max(30),
  defaultChildLimit: z.number().int().min(0).max(30)
}).strict();

const contactInputSchema = z.object({
  role: z.enum(["groom", "bride"]),
  name: requiredText(80),
  phone: requiredText(40),
  isActive: z.boolean()
}).strict();

function toDatabaseEvent(event: DatabaseWeddingContentEvent) {
  return {
    id: event.id,
    slug: event.slug,
    title_en: event.titleEn,
    title_hi: event.titleHi,
    date_en: event.dateEn,
    date_hi: event.dateHi,
    start_time_en: event.startTimeEn,
    start_time_hi: event.startTimeHi,
    arrival_window_en: event.arrivalWindowEn,
    arrival_window_hi: event.arrivalWindowHi,
    start_at: event.startAt,
    end_at: event.endAt,
    venue_en: event.venueEn,
    venue_hi: event.venueHi,
    address_en: event.addressEn,
    address_hi: event.addressHi,
    maps_url: event.mapsUrl,
    entry_note_en: event.entryNoteEn,
    entry_note_hi: event.entryNoteHi,
    dress_code_en: event.dressCodeEn,
    dress_code_hi: event.dressCodeHi,
    practical_note_en: event.practicalNoteEn,
    practical_note_hi: event.practicalNoteHi,
    description_en: event.descriptionEn,
    description_hi: event.descriptionHi,
    popup_details: event.popupDetails,
    category: event.category,
    published: event.published,
    display_order: event.displayOrder
  };
}

function eventIsSafe(event: DatabaseWeddingContentEvent) {
  // Reuse the public mapping's hardened URL, time, and field validation so
  // the editor cannot create a record that would later fail guest rendering.
  return Boolean(mapWeddingEvent(toDatabaseEvent(event)));
}

function timestampIsBeforeOrEqual(first: string, second: string) {
  return Date.parse(first) <= Date.parse(second);
}

function timestampIsBefore(first: string, second: string) {
  return Date.parse(first) < Date.parse(second);
}

/**
 * The browser submits a complete, bounded snapshot. A full document lets the
 * transaction validate cross-record rules (for example, live invitations
 * cannot lose their chosen event) before it changes any row.
 */
export const databaseWeddingContentEditorSchema = z.object({
  revision: z.union([z.string().regex(REVISION), z.null()]),
  settings: settingsInputSchema,
  events: z.array(eventInputSchema).max(MAX_EDITOR_EVENTS),
  contacts: z.array(contactInputSchema).max(MAX_EDITOR_CONTACTS)
}).strict().superRefine((value, context) => {
  const eventIds = new Set<string>();
  const eventSlugs = new Set<string>();
  value.events.forEach((event, index) => {
    if (eventIds.has(event.id)) {
      context.addIssue({ code: "custom", path: ["events", index, "id"], message: "Each event ID must be unique." });
    }
    if (eventSlugs.has(event.slug)) {
      context.addIssue({ code: "custom", path: ["events", index, "slug"], message: "Each event slug must be unique." });
    }
    eventIds.add(event.id);
    eventSlugs.add(event.slug);

    if (Boolean(event.descriptionEn) !== Boolean(event.descriptionHi)) {
      context.addIssue({
        code: "custom",
        path: ["events", index, "descriptionHi"],
        message: "Add the event description in both languages, or leave both blank."
      });
    }

    if (!eventIsSafe(event)) {
      context.addIssue({ code: "custom", path: ["events", index], message: "Review this event's map link and times." });
    }
    if (event.defaultSelected && event.defaultAdultLimit + event.defaultChildLimit === 0) {
      context.addIssue({
        code: "custom",
        path: ["events", index, "defaultAdultLimit"],
        message: "A default-selected event needs room for at least one guest."
      });
    }
  });

  if (!value.events.some((event) => event.published)) {
    context.addIssue({ code: "custom", path: ["events"], message: "Keep at least one celebration published." });
  }

  const contactRoles = new Set<ContactRole>();
  value.contacts.forEach((contact, index) => {
    if (contactRoles.has(contact.role)) {
      context.addIssue({ code: "custom", path: ["contacts", index, "role"], message: "Each reply-to role can appear once." });
    }
    contactRoles.add(contact.role);
    if (!createWeddingContact(contact.role, contact.name, contact.phone)) {
      context.addIssue({ code: "custom", path: ["contacts", index], message: "Enter a valid Indian mobile number for this contact." });
    }
  });

  if (!createWeddingContact("groom", value.settings.coordinatorName, value.settings.coordinatorPhone)) {
    context.addIssue({
      code: "custom",
      path: ["settings", "coordinatorPhone"],
      message: "Enter a valid Indian mobile number for the coordination desk."
    });
  }

  if (!timestampIsBeforeOrEqual(value.settings.canEditUntil, value.settings.rsvpDeadline)) {
    context.addIssue({
      code: "custom",
      path: ["settings", "canEditUntil"],
      message: "The guest edit cutoff cannot be after the RSVP deadline."
    });
  }

  const hasEnglishAnnouncement = Boolean(value.settings.announcementEn);
  const hasHindiAnnouncement = Boolean(value.settings.announcementHi);
  if (hasEnglishAnnouncement !== hasHindiAnnouncement) {
    context.addIssue({
      code: "custom",
      path: ["settings", "announcementEn"],
      message: "Provide both English and Hindi announcement text, or leave both blank."
    });
  }
  if (!hasEnglishAnnouncement && (value.settings.announcementStartsAt || value.settings.announcementEndsAt)) {
    context.addIssue({
      code: "custom",
      path: ["settings", "announcementStartsAt"],
      message: "Add announcement text before setting its schedule."
    });
  }
  if (
    value.settings.announcementStartsAt
    && value.settings.announcementEndsAt
    && !timestampIsBefore(value.settings.announcementStartsAt, value.settings.announcementEndsAt)
  ) {
    context.addIssue({
      code: "custom",
      path: ["settings", "announcementEndsAt"],
      message: "The announcement end must be after its start."
    });
  }

  if (value.settings.guestContent !== null && parseWeddingGuestContent(value.settings.guestContent) === undefined) {
    context.addIssue({
      code: "custom",
      path: ["settings", "guestContent"],
      message: "Guest content must use the supported text, artwork, and travel-icon fields."
    });
  }
});

export type DatabaseWeddingContentEditorInput = z.infer<typeof databaseWeddingContentEditorSchema>;

export type DatabaseWeddingContentSaveResult =
  | { kind: "saved"; snapshot: DatabaseWeddingContentSnapshot }
  | { kind: "stale"; snapshot: DatabaseWeddingContentSnapshot }
  | { kind: "event_side_conflict" }
  | { kind: "events_missing" }
  | { kind: "contacts_missing" }
  | { kind: "active_event_reference" }
  | { kind: "active_contact_reference" }
  | { kind: "link_expiry_conflict" };

const EMPTY_SETTINGS: DatabaseWeddingContentSettings = {
  coupleNamesEn: "",
  coupleNamesHi: "",
  weddingDateEn: "",
  weddingDateHi: "",
  locationEn: "",
  locationHi: "",
  weddingMoment: "",
  rsvpDeadline: "",
  canEditUntil: "",
  coordinatorName: "",
  coordinatorPhone: "",
  announcementEn: "",
  announcementHi: "",
  announcementStartsAt: null,
  announcementEndsAt: null,
  guestContent: null
};

function normalizedTimestamp(value: Date | string, label: string) {
  const result = normalizeDatabaseTimestamp(value);
  if (!result) throw new Error(`The ${label} timestamp is invalid.`);
  return result;
}

function normalizedNullableTimestamp(value: Date | string | null, label: string) {
  if (value === null) return null;
  return normalizedTimestamp(value, label);
}

function numberValue(value: number | string, label: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`The ${label} value is invalid.`);
  return result;
}

function settingsFromRow(row: DatabaseEditorSettingsRow): DatabaseWeddingContentSettings {
  return {
    coupleNamesEn: row.couple_names_en,
    coupleNamesHi: row.couple_names_hi,
    weddingDateEn: row.wedding_date_en,
    weddingDateHi: row.wedding_date_hi,
    locationEn: row.location_en,
    locationHi: row.location_hi,
    weddingMoment: normalizedTimestamp(row.wedding_moment, "wedding moment"),
    rsvpDeadline: normalizedTimestamp(row.rsvp_deadline, "RSVP deadline"),
    canEditUntil: normalizedTimestamp(row.can_edit_until, "guest edit cutoff"),
    coordinatorName: row.coordinator_name,
    coordinatorPhone: row.coordinator_phone,
    announcementEn: row.announcement_en ?? "",
    announcementHi: row.announcement_hi ?? "",
    announcementStartsAt: normalizedNullableTimestamp(row.announcement_starts_at, "announcement start"),
    announcementEndsAt: normalizedNullableTimestamp(row.announcement_ends_at, "announcement end"),
    guestContent: row.guest_content ?? null
  };
}

function eventFromRow(row: DatabaseEditorEventRow): DatabaseWeddingContentEvent {
  return {
    id: row.id,
    slug: row.slug,
    titleEn: row.title_en,
    titleHi: row.title_hi,
    dateEn: row.date_en,
    dateHi: row.date_hi,
    startTimeEn: row.start_time_en,
    startTimeHi: row.start_time_hi,
    arrivalWindowEn: row.arrival_window_en,
    arrivalWindowHi: row.arrival_window_hi,
    startAt: normalizedTimestamp(row.start_at, `${row.id} start`),
    endAt: normalizedTimestamp(row.end_at, `${row.id} end`),
    venueEn: row.venue_en,
    venueHi: row.venue_hi,
    addressEn: row.address_en,
    addressHi: row.address_hi,
    mapsUrl: row.maps_url,
    entryNoteEn: row.entry_note_en,
    entryNoteHi: row.entry_note_hi,
    dressCodeEn: row.dress_code_en,
    dressCodeHi: row.dress_code_hi,
    practicalNoteEn: row.practical_note_en,
    practicalNoteHi: row.practical_note_hi,
    descriptionEn: row.description_en ?? "",
    descriptionHi: row.description_hi ?? "",
    popupDetails: parseWeddingEventPopupDetails(row.popup_details) ?? [],
    category: row.category,
    published: row.published,
    displayOrder: numberValue(row.display_order, `${row.id} display order`),
    defaultSelected: row.default_selected,
    defaultAdultLimit: numberValue(row.default_adult_limit, `${row.id} adult limit`),
    defaultChildLimit: numberValue(row.default_child_limit, `${row.id} child limit`)
  };
}

function contactFromRow(row: DatabaseEditorContactRow): DatabaseWeddingContentContact {
  return {
    role: row.role,
    name: row.name,
    phone: row.phone,
    isActive: row.is_active
  };
}

function revisionFor(snapshot: Omit<DatabaseWeddingContentSnapshot, "revision">) {
  return createHash("sha256")
    .update(JSON.stringify(snapshot), "utf8")
    .digest("hex");
}

async function loadEditorSnapshotWith(client: DatabaseQueryable, side: WeddingSide): Promise<DatabaseWeddingContentSnapshot> {
  const [settingsResult, eventsResult, contactsResult] = await Promise.all([
    client.query<DatabaseEditorSettingsRow>(
      `select
         couple_names_en, couple_names_hi,
         wedding_date_en, wedding_date_hi,
         location_en, location_hi,
         wedding_moment, rsvp_deadline, can_edit_until,
         coordinator_name, coordinator_phone,
         announcement_en, announcement_hi,
         announcement_starts_at, announcement_ends_at,
         guest_content
       from wedding.settings
      where id = $1 and side = $2
      limit 1`,
      [weddingSideSettingsId(side), side]
    ),
    client.query<DatabaseEditorEventRow>(
      `select
         id, slug,
         title_en, title_hi, date_en, date_hi,
         start_time_en, start_time_hi,
         arrival_window_en, arrival_window_hi,
         start_at, end_at,
         venue_en, venue_hi, address_en, address_hi, maps_url,
         entry_note_en, entry_note_hi,
         dress_code_en, dress_code_hi,
         practical_note_en, practical_note_hi,
         description_en, description_hi, popup_details,
         category, published, display_order,
         default_selected, default_adult_limit, default_child_limit
       from wedding.events
      where side = $1
      order by display_order asc, start_at asc, id asc`,
      [side]
    ),
    client.query<DatabaseEditorContactRow>(
      `select role, name, phone, is_active
         from wedding.contacts
        where side = $1
        order by role asc`,
      [side]
    )
  ]);

  const settingsRow = settingsResult.rows[0];
  const events = eventsResult.rows.map(eventFromRow);
  const contacts = contactsResult.rows.map(contactFromRow);
  if (!settingsRow) {
    // A fresh durable database is deliberately empty. Let a signed
    // coordinator bootstrap it in the editor instead of forcing SQL access.
    return { side, revision: null, settings: { ...EMPTY_SETTINGS }, events, contacts };
  }

  const withoutRevision = { side, settings: settingsFromRow(settingsRow), events, contacts };
  return { ...withoutRevision, revision: revisionFor(withoutRevision) };
}

/** Load only explicitly selected, coordinator-safe configuration fields. */
export async function loadDatabaseWeddingContentEditor(side: WeddingSide = "groom") {
  requireWeddingSide(side);
  const client = await getDatabasePool().connect();
  let transactionOpen = false;
  try {
    // A GET is normally three independent SELECTs. A repeatable-read snapshot
    // prevents a coordinator from receiving settings from one atomic save and
    // events from the next one if a save commits mid-read.
    await client.query("begin transaction isolation level repeatable read read only");
    transactionOpen = true;
    const snapshot = await loadEditorSnapshotWith(client, side);
    await client.query("commit");
    transactionOpen = false;
    return snapshot;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the original error for the coordinator availability UI.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

function normalizedInputTimestamp(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("The editor timestamp is invalid.");
  return parsed.toISOString();
}

function normalizedInputNullableTimestamp(value: string | null) {
  return value === null ? null : normalizedInputTimestamp(value);
}

function invitationEventIds(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value);
}

function persistableGuestContent(value: unknown | null): WeddingGuestContent | null {
  if (value === null) return null;
  const parsed = parseWeddingGuestContent(value);
  if (!parsed) throw new Error("The guest content is invalid.");
  return parsed;
}

function normalizedContact(contact: DatabaseWeddingContentContact) {
  const normalized = createWeddingContact(contact.role, contact.name, contact.phone);
  if (!normalized) throw new Error("The contact is invalid.");
  return {
    ...contact,
    name: normalized.name,
    // `phoneHref` is built exclusively from the validated E.164 number.
    phone: normalized.phoneHref.slice("tel:".length)
  };
}

function eventWasArchived(
  currentEvents: DatabaseWeddingContentEvent[],
  inputEvents: DatabaseWeddingContentEvent[]
) {
  const currentById = new Map(currentEvents.map((event) => [event.id, event]));
  return inputEvents
    .filter((event) => currentById.get(event.id)?.published && !event.published)
    .map((event) => event.id);
}

function contactWasDisabled(
  currentContacts: DatabaseWeddingContentContact[],
  inputContacts: DatabaseWeddingContentContact[]
) {
  const currentByRole = new Map(currentContacts.map((contact) => [contact.role, contact]));
  return inputContacts
    .filter((contact) => currentByRole.get(contact.role)?.isActive && !contact.isActive)
    .map((contact) => contact.role);
}

/**
 * Atomically persist a complete coordinator content snapshot. Existing event
 * and contact rows are never deleted here: archive an event or disable a
 * contact instead, preserving the historical data behind invitation records.
 */
export async function saveDatabaseWeddingContentEditor(
  input: DatabaseWeddingContentEditorInput,
  side: WeddingSide = "groom"
): Promise<DatabaseWeddingContentSaveResult> {
  requireWeddingSide(side);
  const client = await getDatabasePool().connect();
  let transactionOpen = false;

  try {
    await client.query("begin");
    transactionOpen = true;

    // Invitation issuance takes this same transaction lock before loading
    // the schedule. The table locks serialize content edits and keep the
    // revision check deterministic without granting table-wide privileges on
    // invitation records to the runtime database role.
    await lockDatabaseContentAndInvitationIssue(client, side);
    await client.query(
      "lock table wedding.settings, wedding.events, wedding.contacts in share row exclusive mode"
    );

    const current = await loadEditorSnapshotWith(client, side);
    if (current.revision !== input.revision) {
      await client.query("rollback");
      transactionOpen = false;
      return { kind: "stale", snapshot: current };
    }

    const existingEventIds = new Set(current.events.map((event) => event.id));
    const submittedEventIds = new Set(input.events.map((event) => event.id));
    const { rows: conflictingEvents } = await client.query<{ id: string }>(
      "select id from wedding.events where id = any($1::text[]) and side <> $2",
      [[...submittedEventIds], side]
    );
    if (conflictingEvents.length > 0) {
      await client.query("rollback");
      transactionOpen = false;
      return { kind: "event_side_conflict" };
    }
    if ([...existingEventIds].some((id) => !submittedEventIds.has(id))) {
      await client.query("rollback");
      transactionOpen = false;
      return { kind: "events_missing" };
    }

    const existingContactRoles = new Set(current.contacts.map((contact) => contact.role));
    const submittedContactRoles = new Set(input.contacts.map((contact) => contact.role));
    if ([...existingContactRoles].some((role) => !submittedContactRoles.has(role))) {
      await client.query("rollback");
      transactionOpen = false;
      return { kind: "contacts_missing" };
    }

    const { rows: activeReferences } = await client.query<ActiveInvitationReferenceRow>(
      `select contact_role, event_limits, access_expires_at
         from wedding.invitations
        where status = 'active'
          and access_expires_at > now()
          and side = $1`,
      [side]
    );
    const archivedEventIds = new Set(eventWasArchived(current.events, input.events));
    if (activeReferences.some((reference) => invitationEventIds(reference.event_limits).some((id) => archivedEventIds.has(id)))) {
      await client.query("rollback");
      transactionOpen = false;
      return { kind: "active_event_reference" };
    }

    const disabledContactRoles = new Set(contactWasDisabled(current.contacts, input.contacts));
    if (activeReferences.some((reference) => disabledContactRoles.has(reference.contact_role))) {
      await client.query("rollback");
      transactionOpen = false;
      return { kind: "active_contact_reference" };
    }

    const newDeadline = Date.parse(input.settings.rsvpDeadline);
    if (activeReferences.some((reference) => newDeadline > Date.parse(normalizedTimestamp(reference.access_expires_at, "invitation expiry")))) {
      await client.query("rollback");
      transactionOpen = false;
      return { kind: "link_expiry_conflict" };
    }

    const primaryContact = createWeddingContact(side, input.settings.coordinatorName, input.settings.coordinatorPhone);
    if (!primaryContact) throw new Error("The coordination contact is invalid.");
    const guestContent = persistableGuestContent(input.settings.guestContent);

    await client.query(
      `insert into wedding.settings (
         id, side,
         couple_names_en, couple_names_hi,
         wedding_date_en, wedding_date_hi,
         location_en, location_hi,
         wedding_moment, rsvp_deadline, can_edit_until,
         coordinator_name, coordinator_phone,
         announcement_en, announcement_hi,
         announcement_starts_at, announcement_ends_at,
         guest_content
       ) values (
         $17, $18,
         $1, $2,
         $3, $4,
         $5, $6,
         $7, $8, $9,
         $10, $11,
         $12, $13,
         $14, $15,
         $16::jsonb
       )
       on conflict (id) do update set
         couple_names_en = excluded.couple_names_en,
         couple_names_hi = excluded.couple_names_hi,
         wedding_date_en = excluded.wedding_date_en,
         wedding_date_hi = excluded.wedding_date_hi,
         location_en = excluded.location_en,
         location_hi = excluded.location_hi,
         wedding_moment = excluded.wedding_moment,
         rsvp_deadline = excluded.rsvp_deadline,
         can_edit_until = excluded.can_edit_until,
         coordinator_name = excluded.coordinator_name,
         coordinator_phone = excluded.coordinator_phone,
         announcement_en = excluded.announcement_en,
         announcement_hi = excluded.announcement_hi,
         announcement_starts_at = excluded.announcement_starts_at,
         announcement_ends_at = excluded.announcement_ends_at,
         guest_content = excluded.guest_content,
         updated_at = now()
       where wedding.settings.side = excluded.side`,
      [
        input.settings.coupleNamesEn,
        input.settings.coupleNamesHi,
        input.settings.weddingDateEn,
        input.settings.weddingDateHi,
        input.settings.locationEn,
        input.settings.locationHi,
        normalizedInputTimestamp(input.settings.weddingMoment),
        normalizedInputTimestamp(input.settings.rsvpDeadline),
        normalizedInputTimestamp(input.settings.canEditUntil),
        primaryContact.name,
        primaryContact.phoneHref.slice("tel:".length),
        input.settings.announcementEn || null,
        input.settings.announcementHi || null,
        normalizedInputNullableTimestamp(input.settings.announcementStartsAt),
        normalizedInputNullableTimestamp(input.settings.announcementEndsAt),
        guestContent ? JSON.stringify(guestContent) : null,
        weddingSideSettingsId(side), side
      ]
    );

    for (const contactInput of input.contacts) {
      const contact = normalizedContact(contactInput);
      await client.query(
        `insert into wedding.contacts (role, name, phone, is_active, side)
         values ($1, $2, $3, $4, $5)
         on conflict (side, role) do update set
           name = excluded.name,
           phone = excluded.phone,
           is_active = excluded.is_active,
           updated_at = now()`,
        [contact.role, contact.name, contact.phone, contact.isActive, side]
      );
    }

    for (const event of input.events) {
      const { rows: savedEvents } = await client.query<{ id: string }>(
        `insert into wedding.events (
           id, slug, side,
           title_en, title_hi, date_en, date_hi,
           start_time_en, start_time_hi,
           arrival_window_en, arrival_window_hi,
           start_at, end_at,
           venue_en, venue_hi, address_en, address_hi, maps_url,
           entry_note_en, entry_note_hi,
           dress_code_en, dress_code_hi,
           practical_note_en, practical_note_hi,
           description_en, description_hi, popup_details,
           category, published, display_order,
           default_selected, default_adult_limit, default_child_limit
         ) values (
           $1, $2, $33,
           $3, $4, $5, $6,
           $7, $8,
           $9, $10,
           $11, $12,
           $13, $14, $15, $16, $17,
           $18, $19,
           $20, $21,
           $22, $23,
           $24, $25, $26::jsonb,
           $27, $28, $29,
           $30, $31, $32
         )
         on conflict (id) do update set
           slug = excluded.slug,
           title_en = excluded.title_en,
           title_hi = excluded.title_hi,
           date_en = excluded.date_en,
           date_hi = excluded.date_hi,
           start_time_en = excluded.start_time_en,
           start_time_hi = excluded.start_time_hi,
           arrival_window_en = excluded.arrival_window_en,
           arrival_window_hi = excluded.arrival_window_hi,
           start_at = excluded.start_at,
           end_at = excluded.end_at,
           venue_en = excluded.venue_en,
           venue_hi = excluded.venue_hi,
           address_en = excluded.address_en,
           address_hi = excluded.address_hi,
           maps_url = excluded.maps_url,
           entry_note_en = excluded.entry_note_en,
           entry_note_hi = excluded.entry_note_hi,
           dress_code_en = excluded.dress_code_en,
           dress_code_hi = excluded.dress_code_hi,
           practical_note_en = excluded.practical_note_en,
           practical_note_hi = excluded.practical_note_hi,
           description_en = excluded.description_en,
           description_hi = excluded.description_hi,
           popup_details = excluded.popup_details,
           category = excluded.category,
           published = excluded.published,
           display_order = excluded.display_order,
           default_selected = excluded.default_selected,
           default_adult_limit = excluded.default_adult_limit,
           default_child_limit = excluded.default_child_limit,
           updated_at = now()
         where wedding.events.side = excluded.side
         returning id`,
        [
          event.id, event.slug,
          event.titleEn, event.titleHi, event.dateEn, event.dateHi,
          event.startTimeEn, event.startTimeHi,
          event.arrivalWindowEn, event.arrivalWindowHi,
          normalizedInputTimestamp(event.startAt), normalizedInputTimestamp(event.endAt),
          event.venueEn, event.venueHi, event.addressEn, event.addressHi, event.mapsUrl,
          event.entryNoteEn, event.entryNoteHi,
          event.dressCodeEn, event.dressCodeHi,
          event.practicalNoteEn, event.practicalNoteHi,
          event.descriptionEn, event.descriptionHi, JSON.stringify(event.popupDetails),
          event.category, event.published, event.displayOrder,
          event.defaultSelected, event.defaultAdultLimit, event.defaultChildLimit,
          side
        ]
      );
      if (savedEvents.length !== 1) {
        await client.query("rollback");
        transactionOpen = false;
        return { kind: "event_side_conflict" };
      }
    }

    const snapshot = await loadEditorSnapshotWith(client, side);
    await client.query("commit");
    transactionOpen = false;
    return { kind: "saved", snapshot };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the original error so the route can return one generic
        // recovery-safe message without leaking database details.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
