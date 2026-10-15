import { randomBytes, randomUUID } from "node:crypto";

import { z } from "zod";

import { invitationTokenSchema } from "../domain/rsvp.js";
import { requireWeddingSide } from "../domain/wedding-side.js";
import {
  hasDatabaseEntryPassEligibility,
  invalidateDatabaseEntryPassesInTransaction,
  databaseEntryAttendanceForEvent,
  databaseEntryPassCheckInSchema,
  databaseEntryPassTokenDigest,
  syncDatabaseEntryPassInTransaction,
  type DatabaseEntryPassCheckInResult
} from "./database-entry-passes.js";
import {
  getDatabaseWeddingIssuerOptions,
  loadDatabaseWeddingConfiguration,
  databaseWeddingContact,
  type DatabaseWeddingConfiguration
} from "./database-wedding-content.js";
import { lockDatabaseContentAndInvitationIssue } from "./database-content-lock.js";
import { getDatabasePool, loadDatabaseRSVP, databaseInvitationTokenDigest } from "./database-rsvps.js";
import type {
  AttendanceInput,
  ContactRole,
  Invitation,
  DatabaseCoordinatorInvitation,
  DatabaseInvitationEventOption,
  DatabaseInvitationIssuerOptions,
  DatabaseInvitationStatus,
  LocalizedText,
  ResolvedInvitation,
  RSVPStatus,
  EntryPass,
  WeddingSide
} from "../domain/types.js";

const guestLimitSchema = z.object({
  eventId: z.string().min(1).max(100),
  adults: z.number().int().min(0).max(30),
  children: z.number().int().min(0).max(30)
}).strict();

const optionalHouseholdNameSchema = z.string().trim().max(100).optional();
const INVITATION_ACCESS_GRACE_MILLISECONDS = 90 * 24 * 60 * 60 * 1_000;

/**
 * The only payload accepted by the coordinator issuer. The
 * route parses this strictly before the adapter receives it.
 */
export const databaseInvitationIssueSchema = z.object({
  householdNameEn: optionalHouseholdNameSchema,
  householdNameHi: optionalHouseholdNameSchema,
  preferredLocale: z.enum(["en", "hi"]).default("en"),
  contactRole: z.enum(["groom", "bride"]).default("groom"),
  eventLimits: z.array(guestLimitSchema).min(1).max(12)
}).strict().superRefine((value, context) => {
  const english = value.householdNameEn?.trim() ?? "";
  const hindi = value.householdNameHi?.trim() ?? "";

  if (!english && !hindi) {
    context.addIssue({
      code: "custom",
      path: ["householdNameEn"],
      message: "Enter an English or Hindi household name."
    });
  }
  if (english && english.length < 2) {
    context.addIssue({
      code: "custom",
      path: ["householdNameEn"],
      message: "Household names need at least two characters."
    });
  }
  if (hindi && hindi.length < 2) {
    context.addIssue({
      code: "custom",
      path: ["householdNameHi"],
      message: "Household names need at least two characters."
    });
  }
});

/** The coordinator revoke endpoint receives only this non-secret invitation ID. */
export const databaseInvitationRevokeSchema = z.object({
  invitationId: z.string().uuid()
}).strict();

/** The coordinator RSVP removal endpoint receives only a non-secret invitation ID. */
export const databaseInvitationRsvpDeleteSchema = z.object({
  invitationId: z.string().uuid()
}).strict();

type ParsedDatabaseInvitationIssue = z.output<typeof databaseInvitationIssueSchema>;

export type DatabaseInvitationIssue = {
  householdNameEn: string;
  householdNameHi: string;
  preferredLocale: "en" | "hi";
  contactRole: ContactRole;
  eventLimits: Array<{ eventId: string; adults: number; children: number }>;
};

export type DatabaseInvitationIssueValidation =
  | { ok: true; value: DatabaseInvitationIssue }
  | { ok: false; message: string };

type DatabaseInvitationRow = {
  id: string;
  side: WeddingSide;
  household_name_en: string;
  household_name_hi: string;
  preferred_locale: "en" | "hi";
  contact_role: ContactRole;
  status: DatabaseInvitationStatus;
  revoked_at: Date | string | null;
  rsvp_deleted_at: Date | string | null;
  event_limits: unknown;
  created_at: Date | string;
};

type IssuedDatabaseInvitationRow = Pick<DatabaseInvitationRow, "id" | "created_at">;
type RevokedDatabaseInvitationRow = Pick<DatabaseInvitationRow, "id" | "revoked_at">;

type LockedDatabaseInvitationRow = Pick<DatabaseInvitationRow, "id" | "status" | "household_name_en" | "household_name_hi" | "preferred_locale" | "event_limits"> & {
  token_hash: string;
};

type DatabaseInvitationForRsvpDeletionRow = {
  id: string;
  token_hash: string;
  status: DatabaseInvitationStatus;
  rsvp_deleted_at: Date | string | null;
};

type RsvpDeletionAuditRow = Pick<DatabaseInvitationForRsvpDeletionRow, "id" | "rsvp_deleted_at">;

type DatabaseCoordinatorRow = DatabaseInvitationRow & {
  rsvp_respondent_name: string | null;
  rsvp_status: RSVPStatus | null;
  rsvp_attendances: unknown | null;
  rsvp_comfort_note: string | null;
  rsvp_decline_message: string | null;
  rsvp_updated_at: Date | string | null;
  entry_pass_status: "active" | "invalidated" | null;
  entry_pass_issued_at: Date | string | null;
  entry_pass_invalidated_at: Date | string | null;
  entry_pass_first_checked_in_at: Date | string | null;
  entry_pass_scan_count: number | string | null;
};

type DatabaseEntryPassForResolutionRsvpRow = {
  status: RSVPStatus;
  attendances: unknown;
};

type DatabaseEntryPassLookupRow = {
  invitation_id: string;
};

type DatabaseEntryPassForCheckInRow = {
  id: string;
  status: "active" | "invalidated";
};

type DatabaseCheckInRow = {
  id: string;
  checked_in_at: Date | string;
  scan_count: number | string;
};

export type DatabaseRsvpDeletionResult =
  | { kind: "deleted"; id: string; rsvpDeletedAt: string }
  | { kind: "already_deleted"; id: string; rsvpDeletedAt: string }
  | { kind: "not_revoked" }
  | { kind: "not_found" }
  | { kind: "no_rsvp" };

export type DatabaseCheckInResult =
  | (Extract<DatabaseEntryPassCheckInResult, { kind: "checked_in" | "already_checked_in" }> & {
    event: DatabaseInvitationEventOption;
  })
  | Exclude<DatabaseEntryPassCheckInResult, { kind: "checked_in" | "already_checked_in" }>;

const persistedEventLimitsSchema = z.record(z.string().min(1).max(100), z.object({
  adults: z.number().int().min(0).max(30),
  children: z.number().int().min(0).max(30)
}).strict());

const coordinatorRsvpSchema = z.object({
  respondentName: z.string().trim().min(2).max(100),
  status: z.enum(["attending", "declined", "confirming"]),
  comfortNote: z.string().max(500).optional(),
  declineMessage: z.string().max(500).optional(),
  attendances: z.array(z.object({
    eventId: z.string().min(1).max(100),
    attending: z.boolean(),
    adults: z.number().int().min(0).max(30),
    children: z.number().int().min(0).max(30)
  }).strict()).max(12)
}).strict();

function normalizeTimestamp(value: Date | string) {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(timestamp.getTime())) throw new Error("The invitation timestamp is invalid.");
  return timestamp.toISOString();
}

function normalizedName(value: string | undefined) {
  return value?.trim() ?? "";
}

/** Bound a bearer link to the configured RSVP lifecycle, not its issue date. */
function invitationAccessExpiry(configuration: DatabaseWeddingConfiguration) {
  const deadline = Date.parse(configuration.rsvpDeadlineAt);
  const expiresAt = deadline + INVITATION_ACCESS_GRACE_MILLISECONDS;
  if (!Number.isFinite(deadline) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("The configured RSVP deadline cannot issue an active invitation.");
  }
  return new Date(expiresAt).toISOString();
}

/** Validate structural limits before looking at the current database schedule. */
function validateDatabaseInvitationIssueShape(value: ParsedDatabaseInvitationIssue): DatabaseInvitationIssueValidation {
  const english = normalizedName(value.householdNameEn);
  const hindi = normalizedName(value.householdNameHi);
  if (!english && !hindi) return { ok: false, message: "Enter an English or Hindi household name." };
  if ((english && english.length < 2) || (hindi && hindi.length < 2)) {
    return { ok: false, message: "Household names need at least two characters." };
  }

  const seenEventIds = new Set<string>();
  for (const limit of value.eventLimits) {
    if (seenEventIds.has(limit.eventId)) {
      return { ok: false, message: "Each celebration can only be selected once." };
    }
    seenEventIds.add(limit.eventId);
    if (limit.adults + limit.children === 0) {
      return { ok: false, message: "Each selected celebration needs room for at least one guest." };
    }
  }

  // If one translation is omitted, the supplied name is deliberately used for
  // both locales. This is clearer than an empty family name after a guest
  // switches languages on their personal page.
  return {
    ok: true,
    value: {
      householdNameEn: english || hindi,
      householdNameHi: hindi || english,
      preferredLocale: value.preferredLocale,
      contactRole: value.contactRole,
      eventLimits: value.eventLimits.map((limit) => ({ ...limit }))
    }
  };
}

/**
 * Validate an issuer request against the database's current published
 * schedule. This makes stale/unknown event IDs fail closed even if a caller
 * bypasses the route handler.
 */
function validateDatabaseInvitationIssueForConfiguration(
  value: ParsedDatabaseInvitationIssue,
  configuration: DatabaseWeddingConfiguration
): DatabaseInvitationIssueValidation {
  const structuralValidation = validateDatabaseInvitationIssueShape(value);
  if (!structuralValidation.ok) return structuralValidation;

  const allowedEventIds = new Set(configuration.events.map(({ event }) => event.id));
  if (structuralValidation.value.eventLimits.some((limit) => !allowedEventIds.has(limit.eventId))) {
    return { ok: false, message: "One of the selected celebrations is not available." };
  }
  return structuralValidation;
}

export async function validateDatabaseInvitationIssue(value: ParsedDatabaseInvitationIssue, side: WeddingSide = "groom"): Promise<DatabaseInvitationIssueValidation> {
  requireWeddingSide(side);
  return validateDatabaseInvitationIssueForConfiguration(value, await loadDatabaseWeddingConfiguration(undefined, side));
}

function readPersistedEventLimits(value: unknown) {
  const parsed = persistedEventLimitsSchema.safeParse(value);
  if (!parsed.success) return null;
  return Object.entries(parsed.data).map(([eventId, limit]) => ({ eventId, ...limit }));
}

function rowToIssue(row: Pick<DatabaseInvitationRow, "household_name_en" | "household_name_hi" | "preferred_locale" | "contact_role" | "event_limits">) {
  const eventLimits = readPersistedEventLimits(row.event_limits);
  if (!eventLimits) return null;
  const parsed = databaseInvitationIssueSchema.safeParse({
    householdNameEn: row.household_name_en,
    householdNameHi: row.household_name_hi,
    preferredLocale: row.preferred_locale,
    contactRole: row.contact_role,
    eventLimits
  });
  return parsed.success ? validateDatabaseInvitationIssueShape(parsed.data) : null;
}

function asInvitationEventLimits(issue: DatabaseInvitationIssue): Invitation["eventLimits"] {
  return Object.fromEntries(issue.eventLimits.map((limit) => [limit.eventId, {
    adults: limit.adults,
    children: limit.children
  }]));
}

function householdName(issue: DatabaseInvitationIssue): LocalizedText {
  return { en: issue.householdNameEn, hi: issue.householdNameHi };
}

/** Ensure the requested reply-to person is configured in the wedding database. */
function validateDatabaseInvitationContactRoleForConfiguration(contactRole: ContactRole, configuration: DatabaseWeddingConfiguration) {
  if (databaseWeddingContact(configuration, contactRole)) return { ok: true as const };
  return {
    ok: false as const,
    message: contactRole === "bride"
      ? "Configure an active bride contact in the wedding database before issuing a bride reply-to link."
      : "Configure a valid primary reply-to contact in the wedding database before issuing an invitation."
  };
}

export async function validateDatabaseInvitationContactRole(contactRole: ContactRole, side: WeddingSide = "groom") {
  requireWeddingSide(side);
  return validateDatabaseInvitationContactRoleForConfiguration(contactRole, await loadDatabaseWeddingConfiguration(undefined, side));
}

/** Server-safe form data; it includes neither tokens nor database metadata. */
export async function getDatabaseInvitationIssuerOptions(side: WeddingSide = "groom"): Promise<DatabaseInvitationIssuerOptions> {
  return getDatabaseWeddingIssuerOptions(requireWeddingSide(side));
}

/**
 * Insert a database-backed invitation without ever persisting the bearer token itself.
 * The raw token is returned only to the route handler so it can form the
 * one-time response shown for copying in the coordinator browser.
 */
export async function issueDatabaseInvitation(value: ParsedDatabaseInvitationIssue, side: WeddingSide = "groom") {
  requireWeddingSide(side);
  const client = await getDatabasePool().connect();
  let transactionOpen = false;

  try {
    await client.query("begin");
    transactionOpen = true;
    await lockDatabaseContentAndInvitationIssue(client, side);

    // Use the locked connection for all schedule reads. A pooled read here
    // could exhaust the four-connection pool while other issuers wait on the
    // advisory lock, and it could observe a different content transaction.
    const configuration = await loadDatabaseWeddingConfiguration(client, side);
    const validation = validateDatabaseInvitationIssueForConfiguration(value, configuration);
    if (!validation.ok) throw new Error(validation.message);
    const contactValidation = validateDatabaseInvitationContactRoleForConfiguration(validation.value.contactRole, configuration);
    if (!contactValidation.ok) throw new Error(contactValidation.message);

    const eventLimits = asInvitationEventLimits(validation.value);
    const accessExpiresAt = invitationAccessExpiry(configuration);

    // An ID or 256-bit token collision cannot abort this transaction; retry
    // without ever replacing an existing invitation.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = randomBytes(32).toString("base64url");
      const tokenHash = databaseInvitationTokenDigest(token);
      const invitationId = randomUUID();
      const { rows } = await client.query<IssuedDatabaseInvitationRow>(
        `insert into wedding.invitations (
           id, token_hash, household_name_en, household_name_hi, preferred_locale, contact_role, event_limits, access_expires_at, side
         ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
         on conflict do nothing
         returning id, created_at`,
        [
          invitationId,
          tokenHash,
          validation.value.householdNameEn,
          validation.value.householdNameHi,
          validation.value.preferredLocale,
          validation.value.contactRole,
          JSON.stringify(eventLimits),
          accessExpiresAt,
          side
        ]
      );
      const row = rows[0];
      if (!row) continue;
      await client.query("commit");
      transactionOpen = false;
      return {
        id: row.id,
        side,
        createdAt: normalizeTimestamp(row.created_at),
        token,
        householdName: householdName(validation.value),
        eventCount: validation.value.eventLimits.length,
        contactRole: validation.value.contactRole
      };
    }
    throw new Error("Could not allocate a unique invitation.");
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        // Keep the original database error for the route's generic response.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Disable a bearer link without deleting the household record or RSVP
 * history. A previously issued token stops resolving as soon as this update
 * commits, while the safe coordinator summary keeps the revoke timestamp.
 */
export async function revokeDatabaseInvitation(invitationId: string, side: WeddingSide = "groom") {
  requireWeddingSide(side);
  const parsed = databaseInvitationRevokeSchema.safeParse({ invitationId });
  if (!parsed.success) throw new Error("The invitation ID is invalid.");

  const client = await getDatabasePool().connect();
  let transactionOpen = false;

  try {
    await client.query("begin");
    transactionOpen = true;
    const { rows } = await client.query<RevokedDatabaseInvitationRow>(
      `update wedding.invitations
          set status = 'revoked', revoked_at = coalesce(revoked_at, now())
        where id = $1
          and side = $2
          and status in ('active', 'revoked')
        returning id, revoked_at`,
      [parsed.data.invitationId, side]
    );
    const row = rows[0];
    if (!row?.revoked_at) {
      await client.query("commit");
      transactionOpen = false;
      return null;
    }

    // Keep the QR lifecycle explicit even though the scanner independently
    // validates invitation state. The historical pass/check-in rows remain for
    // an audit, but the credential can no longer be presented.
    await invalidateDatabaseEntryPassesInTransaction(client, row.id, "invitation_revoked", side);
    await client.query("commit");
    transactionOpen = false;
    return { id: row.id, revokedAt: normalizeTimestamp(row.revoked_at) };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the original database error for the caller's generic response.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Permanently erase guest RSVP content only after its bearer invitation has
 * been revoked. The invitation row remains as a timestamp-only audit record.
 *
 * The row lock makes this safe alongside a simultaneous RSVP save or link
 * revocation: the RSVP write completes while the link is active, or it is
 * rejected after revocation; it cannot slip in after this deletion commits.
 */
export async function deleteDatabaseRSVPForRevokedInvitation(invitationId: string, side: WeddingSide = "groom"): Promise<DatabaseRsvpDeletionResult> {
  requireWeddingSide(side);
  const parsed = databaseInvitationRsvpDeleteSchema.safeParse({ invitationId });
  if (!parsed.success) throw new Error("The invitation ID is invalid.");

  const client = await getDatabasePool().connect();
  let transactionOpen = false;

  try {
    await client.query("begin");
    transactionOpen = true;

    const { rows: invitationRows } = await client.query<DatabaseInvitationForRsvpDeletionRow>(
      `select id, token_hash, status, rsvp_deleted_at
         from wedding.invitations
        where id = $1
          and side = $2
        for update`,
      [parsed.data.invitationId, side]
    );
    const invitation = invitationRows[0];

    if (!invitation) {
      await client.query("commit");
      transactionOpen = false;
      return { kind: "not_found" };
    }
    if (invitation.status !== "revoked") {
      await client.query("commit");
      transactionOpen = false;
      return { kind: "not_revoked" };
    }

    // Defensive even when the database revocation trigger already did this:
    // RSVP erasure must never leave a usable entry credential behind.
    await invalidateDatabaseEntryPassesInTransaction(client, invitation.id, "rsvp_deleted", side);

    const { rowCount } = await client.query(
      "delete from wedding.rsvps where token_hash = $1",
      [invitation.token_hash]
    );

    if (rowCount === 0) {
      await client.query("commit");
      transactionOpen = false;
      if (!invitation.rsvp_deleted_at) return { kind: "no_rsvp" };
      return {
        kind: "already_deleted",
        id: invitation.id,
        rsvpDeletedAt: normalizeTimestamp(invitation.rsvp_deleted_at)
      };
    }

    const { rows: auditRows } = await client.query<RsvpDeletionAuditRow>(
      `update wedding.invitations
          set rsvp_deleted_at = coalesce(rsvp_deleted_at, now())
        where id = $1
          and side = $2
          and status = 'revoked'
      returning id, rsvp_deleted_at`,
      [invitation.id, side]
    );
    const audit = auditRows[0];
    if (!audit?.rsvp_deleted_at) throw new Error("The RSVP deletion was not recorded.");

    await client.query("commit");
    transactionOpen = false;
    return {
      kind: "deleted",
      id: audit.id,
      rsvpDeletedAt: normalizeTimestamp(audit.rsvp_deleted_at)
    };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the original database error for the route's generic error.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Recover (or lazily create after a schema upgrade) the guest's deterministic
 * QR payload. The raw QR credential is derived only while serving this already
 * authenticated-by-bearer invitation page; Postgres stores its lookup HMAC and
 * a non-secret rotation UUID, never a raw pass or invitation token.
 */
async function resolveDatabaseEntryPassForInvitation(invitationId: string, invitationToken: string, side: WeddingSide): Promise<EntryPass | null> {
  const client = await getDatabasePool().connect();
  let transactionOpen = false;

  try {
    await client.query("begin");
    transactionOpen = true;
    const tokenHash = databaseInvitationTokenDigest(invitationToken);
    const { rows: invitationRows } = await client.query<LockedDatabaseInvitationRow>(
      `select id, token_hash, household_name_en, household_name_hi, preferred_locale, status, event_limits
         from wedding.invitations
        where id = $1
          and token_hash = $2
          and side = $3
          and status = 'active'
          and access_expires_at > now()
        for update`,
      [invitationId, tokenHash, side]
    );
    const invitation = invitationRows[0];
    if (!invitation) {
      await client.query("commit");
      transactionOpen = false;
      return null;
    }

    const { rows: rsvpRows } = await client.query<DatabaseEntryPassForResolutionRsvpRow>(
      `select status, attendances
         from wedding.rsvps
        where token_hash = $1
        limit 1`,
      [invitation.token_hash]
    );
    const rsvp = rsvpRows[0] ?? null;
    const entryPass = await syncDatabaseEntryPassInTransaction(client, {
      invitationId: invitation.id,
      invitationToken,
      side,
      rsvp
    });
    await client.query("commit");
    transactionOpen = false;
    return entryPass;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the original error so the caller can fail closed.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Atomically accept an active household QR for one selected event. The initial
 * digest lookup reveals no guest data; only a valid, currently eligible pass
 * reaches the success branch that returns a household display name and counts.
 */
export async function checkInDatabaseEntryPass(input: unknown, side: WeddingSide = "groom"): Promise<DatabaseCheckInResult> {
  requireWeddingSide(side);
  const parsed = databaseEntryPassCheckInSchema.safeParse(input);
  if (!parsed.success) throw new Error("The entry-pass scan is invalid.");
  const client = await getDatabasePool().connect();
  let transactionOpen = false;

  try {
    await client.query("begin");
    transactionOpen = true;

    // This first non-locking lookup lets all subsequent locks start with the
    // invitation row. RSVP saves and revocations use that same order, avoiding
    // a scan/revoke deadlock while the re-read below catches any state change.
    const { rows: lookupRows } = await client.query<DatabaseEntryPassLookupRow>(
      `select passes.invitation_id
         from wedding.entry_passes as passes
         join wedding.invitations as invitations on invitations.id = passes.invitation_id
        where passes.token_hash = $1
          and invitations.side = $2
        limit 1`,
      [databaseEntryPassTokenDigest(parsed.data.passToken), side]
    );
    const lookup = lookupRows[0];
    if (!lookup) {
      await client.query("commit");
      transactionOpen = false;
      return { kind: "not_found" };
    }

    const { rows: invitationRows } = await client.query<LockedDatabaseInvitationRow>(
      `select id, token_hash, household_name_en, household_name_hi, preferred_locale, status, event_limits
         from wedding.invitations
        where id = $1
          and side = $2
          and status = 'active'
          and access_expires_at > now()
        for update`,
      [lookup.invitation_id, side]
    );
    const invitation = invitationRows[0];
    if (!invitation) {
      await client.query("commit");
      transactionOpen = false;
      return { kind: "not_found" };
    }

    const configuration = await loadDatabaseWeddingConfiguration(client, side);
    const databaseEvent = configuration.events.find(({ event }) => event.id === parsed.data.eventId);
    if (!databaseEvent) {
      await client.query("commit");
      transactionOpen = false;
      return { kind: "not_eligible" };
    }
    const event = databaseEvent.event;

    const { rows: passRows } = await client.query<DatabaseEntryPassForCheckInRow>(
      `select id, status
         from wedding.entry_passes
        where invitation_id = $1
          and token_hash = $2
        limit 1
        for update`,
      [invitation.id, databaseEntryPassTokenDigest(parsed.data.passToken)]
    );
    const pass = passRows[0];
    if (!pass || pass.status !== "active") {
      await client.query("commit");
      transactionOpen = false;
      return { kind: "not_found" };
    }

    const invitedEvents = readPersistedEventLimits(invitation.event_limits);
    if (!invitedEvents?.some((candidate) => candidate.eventId === event.id)) {
      await client.query("commit");
      transactionOpen = false;
      return { kind: "not_eligible" };
    }

    const { rows: rsvpRows } = await client.query<DatabaseEntryPassForResolutionRsvpRow>(
      `select status, attendances
         from wedding.rsvps
        where token_hash = $1
        limit 1`,
      [invitation.token_hash]
    );
    const rsvp = rsvpRows[0] ?? null;
    if (!rsvp || !hasDatabaseEntryPassEligibility(rsvp.status, rsvp.attendances)) {
      // This is normally handled immediately by the RSVP trigger. It is also
      // defensive against old/manual records that predate that trigger.
      await invalidateDatabaseEntryPassesInTransaction(client, invitation.id, "rsvp_no_longer_attending", side);
      await client.query("commit");
      transactionOpen = false;
      return { kind: "not_eligible" };
    }
    const expectedAttendance = databaseEntryAttendanceForEvent(rsvp.status, rsvp.attendances, event.id);
    if (!expectedAttendance) {
      await client.query("commit");
      transactionOpen = false;
      return { kind: "not_eligible" };
    }

    const { rows: existingCheckInRows } = await client.query<DatabaseCheckInRow>(
      `select id, checked_in_at, scan_count
         from wedding.entry_check_ins
        where entry_pass_id = $1
          and event_id = $2
        limit 1
        for update`,
      [pass.id, event.id]
    );
    const existingCheckIn = existingCheckInRows[0];
    let checkIn: DatabaseCheckInRow;
    let outcome: Extract<DatabaseEntryPassCheckInResult, { kind: "checked_in" | "already_checked_in" }>['kind'];
    if (existingCheckIn) {
      const { rows } = await client.query<DatabaseCheckInRow>(
        `update wedding.entry_check_ins
            set last_scanned_at = now(),
                scan_count = scan_count + 1
          where id = $1
        returning id, checked_in_at, scan_count`,
        [existingCheckIn.id]
      );
      const updated = rows[0];
      if (!updated) throw new Error("The entry-pass scan was not recorded.");
      checkIn = updated;
      outcome = "already_checked_in";
    } else {
      const { rows } = await client.query<DatabaseCheckInRow>(
        `insert into wedding.entry_check_ins (
           id, entry_pass_id, event_id, expected_adult_count, expected_child_count
         ) values ($1, $2, $3, $4, $5)
         returning id, checked_in_at, scan_count`,
        [randomUUID(), pass.id, event.id, expectedAttendance.adults, expectedAttendance.children]
      );
      const inserted = rows[0];
      if (!inserted) throw new Error("The entry-pass scan was not recorded.");
      checkIn = inserted;
      outcome = "checked_in";
    }

    await client.query("commit");
    transactionOpen = false;
    return {
      kind: outcome,
      householdName: invitation.preferred_locale === "hi" ? invitation.household_name_hi : invitation.household_name_en,
      eventId: event.id,
      event: { id: event.id, title: event.title },
      expectedAdults: expectedAttendance.adults,
      expectedChildren: expectedAttendance.children,
      checkedInAt: normalizeTimestamp(checkIn.checked_in_at),
      scanCount: Number(checkIn.scan_count)
    };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the original database error for the route's generic error.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Resolve an issued link by HMAC digest and never by raw token in SQL. */
export async function resolveDatabaseInvitation(token: string, expectedSide?: WeddingSide): Promise<ResolvedInvitation | null> {
  if (!invitationTokenSchema.safeParse(token).success) return null;
  if (expectedSide !== undefined) requireWeddingSide(expectedSide);

  const { rows } = await getDatabasePool().query<DatabaseInvitationRow>(
    `select id, side, household_name_en, household_name_hi, preferred_locale, contact_role, event_limits, created_at
       from wedding.invitations
      where token_hash = $1
        and ($2::text is null or side = $2)
        and status = 'active'
        and access_expires_at > now()
      limit 1`,
    [databaseInvitationTokenDigest(token), expectedSide ?? null]
  );
  const row = rows[0];
  if (!row) return null;
  const side = requireWeddingSide(row.side);

  const validation = rowToIssue(row);
  if (!validation || !validation.ok) throw new Error("The invitation record is invalid.");
  const configuration = await loadDatabaseWeddingConfiguration(undefined, side);
  const contact = databaseWeddingContact(configuration, validation.value.contactRole);
  if (!contact) throw new Error("The invitation reply-to contact is no longer configured.");
  const selectedEventIds = new Set(validation.value.eventLimits.map((limit) => limit.eventId));
  const selectedEvents = configuration.events
    .filter(({ event }) => selectedEventIds.has(event.id))
    .map(({ event }) => event);
  if (selectedEvents.length !== selectedEventIds.size) {
    throw new Error("The invitation references an unknown event.");
  }

  const [rsvp, entryPass] = await Promise.all([
    loadDatabaseRSVP(token),
    // The helper rechecks the RSVP while holding the invitation lock before
    // returning a QR payload, so a concurrent decline/revocation cannot leave
    // a stale pass visible after this response is committed.
    resolveDatabaseEntryPassForInvitation(row.id, token, side)
  ]);

  return {
    invitation: {
      token,
      side,
      householdName: householdName(validation.value),
      preferredLocale: validation.value.preferredLocale,
      eventIds: selectedEvents.map((event) => event.id),
      eventLimits: asInvitationEventLimits(validation.value),
      rsvpDeadline: configuration.rsvpDeadline,
      rsvpDeadlineIso: configuration.rsvpDeadlineIso,
      coordinator: contact
    },
    events: selectedEvents,
    wedding: configuration.wedding,
    rsvp,
    ...(entryPass ? { entryPass } : {})
  };
}

/**
 * Return only safe coordinator summaries. In particular, neither raw
 * URLs nor token digests can be listed after the one-time issuance response.
 */
export async function listDatabaseCoordinatorInvitations(side: WeddingSide = "groom"): Promise<DatabaseCoordinatorInvitation[]> {
  requireWeddingSide(side);
  const { rows } = await getDatabasePool().query<DatabaseCoordinatorRow>(
    `select
       invitations.id,
       invitations.household_name_en,
       invitations.household_name_hi,
       invitations.preferred_locale,
       invitations.contact_role,
       invitations.status,
       invitations.revoked_at,
       invitations.rsvp_deleted_at,
       invitations.event_limits,
       invitations.created_at,
       responses.respondent_name as rsvp_respondent_name,
       responses.status as rsvp_status,
       responses.attendances as rsvp_attendances,
       responses.comfort_note as rsvp_comfort_note,
       responses.decline_message as rsvp_decline_message,
       responses.updated_at as rsvp_updated_at,
       entry_pass.status as entry_pass_status,
       entry_pass.issued_at as entry_pass_issued_at,
       entry_pass.invalidated_at as entry_pass_invalidated_at,
       entry_pass.first_checked_in_at as entry_pass_first_checked_in_at,
       entry_pass.scan_count as entry_pass_scan_count
     from wedding.invitations as invitations
     left join wedding.rsvps as responses on responses.token_hash = invitations.token_hash
     left join lateral (
       select
         passes.status,
         passes.issued_at,
         passes.invalidated_at,
         (
           select min(check_ins.checked_in_at)
             from wedding.entry_check_ins as check_ins
            where check_ins.entry_pass_id = passes.id
         ) as first_checked_in_at,
         coalesce((
           select sum(check_ins.scan_count)::integer
             from wedding.entry_check_ins as check_ins
            where check_ins.entry_pass_id = passes.id
         ), 0) as scan_count
       from wedding.entry_passes as passes
       where passes.invitation_id = invitations.id
       order by passes.issued_at desc
       limit 1
     ) as entry_pass on true
     where invitations.side = $1
     order by invitations.created_at desc, invitations.id`,
    [side]
  );

  return rows.flatMap((row) => {
    const validation = rowToIssue(row);
    if (!validation || !validation.ok) return [];

    let rsvp: DatabaseCoordinatorInvitation["rsvp"] = null;
    if (row.rsvp_status && row.rsvp_attendances && row.rsvp_updated_at) {
      const parsedRsvp = coordinatorRsvpSchema.safeParse({
        respondentName: row.rsvp_respondent_name,
        status: row.rsvp_status,
        attendances: row.rsvp_attendances,
        comfortNote: row.rsvp_comfort_note ?? undefined,
        declineMessage: row.rsvp_decline_message ?? undefined
      });
      if (!parsedRsvp.success) return [];
      rsvp = {
        respondentName: parsedRsvp.data.respondentName,
        status: parsedRsvp.data.status,
        attendances: parsedRsvp.data.attendances as AttendanceInput[],
        comfortNote: parsedRsvp.data.comfortNote,
        declineMessage: parsedRsvp.data.declineMessage,
        updatedAt: normalizeTimestamp(row.rsvp_updated_at)
      };
    }

    let entryPass: DatabaseCoordinatorInvitation["entryPass"] = null;
    if (row.entry_pass_status && row.entry_pass_issued_at) {
      const scanCount = Number(row.entry_pass_scan_count ?? 0);
      if (!Number.isSafeInteger(scanCount) || scanCount < 0) return [];
      entryPass = {
        state: row.entry_pass_status === "active"
          ? row.entry_pass_first_checked_in_at ? "checked-in" : "ready"
          : "invalidated",
        issuedAt: normalizeTimestamp(row.entry_pass_issued_at),
        invalidatedAt: row.entry_pass_invalidated_at ? normalizeTimestamp(row.entry_pass_invalidated_at) : null,
        checkedInAt: row.entry_pass_first_checked_in_at ? normalizeTimestamp(row.entry_pass_first_checked_in_at) : null,
        scanCount
      };
    }

    return [{
      id: row.id,
      householdName: householdName(validation.value),
      preferredLocale: validation.value.preferredLocale,
      contactRole: validation.value.contactRole,
      status: row.status,
      revokedAt: row.revoked_at ? normalizeTimestamp(row.revoked_at) : null,
      rsvpDeletedAt: row.rsvp_deleted_at ? normalizeTimestamp(row.rsvp_deleted_at) : null,
      entryPass,
      eventCount: validation.value.eventLimits.length,
      eventLimits: validation.value.eventLimits,
      createdAt: normalizeTimestamp(row.created_at),
      rsvp
    }];
  });
}
