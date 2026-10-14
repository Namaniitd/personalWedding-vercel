import { createWeddingContact } from "../domain/wedding-contact.js";
import type { PoolClient } from "pg";
import { getDatabasePool } from "./database-rsvps.js";
import {
  formatLocalizedDate,
  mapWeddingEvent,
  mapWeddingSettings,
  normalizeDatabaseTimestamp,
  orderWeddingEvents,
  type DatabaseWeddingEventRow,
  type DatabaseWeddingSettingsRow,
  type MappedWeddingEvent
} from "../domain/wedding-content.js";
import type {
  ContactRole,
  DatabaseInvitationIssuerOptions,
  LocalizedText,
  WeddingContact,
  WeddingDetails,
  WeddingEvent
} from "../domain/types.js";

type DatabaseInvitationSettingsRow = DatabaseWeddingSettingsRow & {
  rsvp_deadline: Date | string;
  can_edit_until: Date | string;
};

type DatabaseInvitationEventRow = DatabaseWeddingEventRow & {
  default_selected: boolean;
  default_adult_limit: number | string;
  default_child_limit: number | string;
};

type DatabaseWeddingContactRow = {
  role: ContactRole;
  name: string;
  phone: string;
  is_active: boolean;
};

export type DatabaseWeddingEvent = {
  event: WeddingEvent;
  defaultSelected: boolean;
  defaultAdults: number;
  defaultChildren: number;
};

export type DatabaseWeddingConfiguration = {
  wedding: WeddingDetails;
  /** The guest-visible, effective cutoff for self-service RSVP changes. */
  rsvpDeadline: LocalizedText;
  /** The configured RSVP cutoff, used to bound bearer-link lifetime. */
  rsvpDeadlineAt: string;
  /** ISO form of the guest-visible self-service RSVP cutoff. */
  rsvpDeadlineIso: string;
  events: DatabaseWeddingEvent[];
  contacts: Partial<Record<ContactRole, WeddingContact>>;
};

class WeddingSettingsNotConfiguredError extends Error {
  constructor() {
    super("Wedding settings have not been configured.");
    this.name = "WeddingSettingsNotConfiguredError";
  }
}

function parseGuestLimit(value: unknown) {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(numeric) && numeric >= 0 && numeric <= 30 ? numeric : null;
}

function mapContacts(settings: DatabaseInvitationSettingsRow, rows: DatabaseWeddingContactRow[]) {
  // The primary reply-to contact lives in the singleton just like hosted
  // settings. Optional active rows can provide a different groom or bride
  // contact, but no role can ever fall back to a hard-coded person or number.
  const primaryContact = createWeddingContact("groom", settings.coordinator_name, settings.coordinator_phone);
  if (!primaryContact) return null;

  const contacts: Partial<Record<ContactRole, WeddingContact>> = { groom: primaryContact };
  for (const row of rows) {
    if (row.role !== "groom" && row.role !== "bride" || typeof row.is_active !== "boolean") return null;
    if (!row.is_active) continue;
    const contact = createWeddingContact(row.role, row.name, row.phone);
    if (!contact) return null;
    contacts[row.role] = contact;
  }
  return contacts;
}

function mapDatabaseEvents(rows: DatabaseInvitationEventRow[]) {
  const mappedEvents: MappedWeddingEvent[] = [];
  const defaults = new Map<string, Omit<DatabaseWeddingEvent, "event">>();

  for (const row of rows) {
    const defaultAdults = parseGuestLimit(row.default_adult_limit);
    const defaultChildren = parseGuestLimit(row.default_child_limit);
    if (typeof row.default_selected !== "boolean" || defaultAdults === null || defaultChildren === null) return null;
    if (row.default_selected && defaultAdults + defaultChildren === 0) return null;

    const mapped = mapWeddingEvent(row);
    if (!mapped || !mapped.event || defaults.has(mapped.event.id)) return null;
    mappedEvents.push(mapped);
    defaults.set(mapped.event.id, {
      defaultSelected: row.default_selected,
      defaultAdults,
      defaultChildren
    });
  }

  return orderWeddingEvents(mappedEvents).flatMap((event) => {
    const eventDefaults = defaults.get(event.id);
    return eventDefaults ? [{ event, ...eventDefaults }] : [];
  });
}

/**
 * Load the complete database-backed wedding configuration from PostgreSQL. This
 * module deliberately has no fixture import: a missing row, invalid contact,
 * malformed event, or empty schedule leaves invitation links unavailable.
 */
export async function loadDatabaseWeddingConfiguration(client?: PoolClient): Promise<DatabaseWeddingConfiguration> {
  const pool = client ?? getDatabasePool();
  const [settingsResult, eventsResult, contactsResult] = await Promise.all([
    pool.query<DatabaseInvitationSettingsRow>(
      `select
         couple_names_en, couple_names_hi,
         wedding_date_en, wedding_date_hi,
         location_en, location_hi,
         wedding_moment,
         rsvp_deadline, can_edit_until,
         coordinator_name, coordinator_phone,
         announcement_en, announcement_hi,
         announcement_starts_at, announcement_ends_at,
         guest_content
       from wedding.settings
      where id = 1
      limit 1`
    ),
    pool.query<DatabaseInvitationEventRow>(
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
         category, published, display_order,
         default_selected, default_adult_limit, default_child_limit
       from wedding.events
      where published = true
      order by display_order asc, start_at asc, id asc`
    ),
    pool.query<DatabaseWeddingContactRow>(
      `select role, name, phone, is_active
         from wedding.contacts
        order by role asc`
    )
  ]);

  const settings = settingsResult.rows[0];
  if (!settings) throw new WeddingSettingsNotConfiguredError();
  const wedding = mapWeddingSettings(settings);
  // `can_edit_until` is the live, enforced self-service cutoff. Showing the
  // later administrative RSVP deadline here would promise an edit window the
  // guest route correctly refuses.
  const rsvpDeadline = formatLocalizedDate(settings.can_edit_until);
  const rsvpDeadlineIso = normalizeDatabaseTimestamp(settings.can_edit_until);
  const deadlineIso = normalizeDatabaseTimestamp(settings.rsvp_deadline);
  const contacts = mapContacts(settings, contactsResult.rows);
  const events = mapDatabaseEvents(eventsResult.rows);

  if (!wedding || !rsvpDeadline || !rsvpDeadlineIso || !deadlineIso || rsvpDeadlineIso > deadlineIso || !contacts || !events || events.length === 0) {
    throw new Error("Wedding database configuration is invalid.");
  }

  return { wedding, rsvpDeadline, rsvpDeadlineAt: deadlineIso, rsvpDeadlineIso, events, contacts };
}

export function databaseWeddingContact(configuration: DatabaseWeddingConfiguration, role: ContactRole) {
  return configuration.contacts[role] ?? null;
}

/** Safe DTO for the coordinator form; it contains no database metadata. */
export async function getDatabaseWeddingIssuerOptions(): Promise<DatabaseInvitationIssuerOptions> {
  let configuration: DatabaseWeddingConfiguration;
  try {
    configuration = await loadDatabaseWeddingConfiguration();
  } catch (error) {
    // An unconfigured wedding still needs a coordinator workspace so its
    // Content editor can complete setup. Guest links remain strict, and query
    // failures or invalid saved configuration must still report unavailable.
    if (!(error instanceof WeddingSettingsNotConfiguredError)) throw error;
    return {
      events: [],
      defaultEventLimits: [],
      contactOptions: [],
      defaultContactRole: "groom"
    };
  }
  const groom = databaseWeddingContact(configuration, "groom");
  if (!groom) throw new Error("The primary reply-to contact is invalid.");
  const bride = databaseWeddingContact(configuration, "bride");

  return {
    events: configuration.events.map(({ event }) => ({ id: event.id, title: event.title })),
    defaultEventLimits: configuration.events
      .filter((event) => event.defaultSelected)
      .map((event) => ({
        eventId: event.event.id,
        adults: event.defaultAdults,
        children: event.defaultChildren
      })),
    contactOptions: [groom, ...(bride ? [bride] : [])].map((contact) => ({
      role: contact.role,
      name: contact.name,
      phoneDisplay: contact.phoneDisplay
    })),
    defaultContactRole: groom.role
  };
}
