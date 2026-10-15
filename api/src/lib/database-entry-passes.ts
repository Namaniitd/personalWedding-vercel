import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { PoolClient } from "pg";
import { z } from "zod";

import { createEntryPassPayload, entryPassTokenSchema } from "../domain/entry-pass.js";
import type { AttendanceInput, EntryPass, RSVPStatus, WeddingSide } from "../domain/types.js";
import { requireWeddingSide } from "../domain/wedding-side.js";

const ENTRY_PASS_KEY_CONTEXT = "shaadi-companion/database-entry-pass/v1";

const persistedAttendanceSchema = z.array(z.object({
  eventId: z.string().min(1).max(100),
  attending: z.boolean(),
  adults: z.number().int().min(0).max(30),
  children: z.number().int().min(0).max(30)
}).strict()).max(12);

export const databaseEntryPassCheckInSchema = z.object({
  passToken: entryPassTokenSchema,
  eventId: z.string().min(1).max(100)
}).strict();

type DatabaseEntryPassRow = {
  id: string;
  invitation_id: string;
  token_hash: string;
  pass_version: string;
  status: "active" | "invalidated";
  issued_at: Date | string;
  invalidated_at: Date | string | null;
  first_checked_in_at: Date | string | null;
};

type DatabaseEntryPassInsertRow = Pick<DatabaseEntryPassRow, "id" | "invitation_id" | "token_hash" | "pass_version" | "status" | "issued_at" | "invalidated_at">;

type DatabaseRsvpForPass = {
  status: RSVPStatus;
  attendances: unknown;
};

export type DatabaseEntryPassCheckInResult =
  | {
    kind: "checked_in" | "already_checked_in";
    householdName: string;
    eventId: string;
    expectedAdults: number;
    expectedChildren: number;
    checkedInAt: string;
    scanCount: number;
  }
  | { kind: "not_found" }
  | { kind: "not_eligible" };

function normalizeTimestamp(value: Date | string) {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(timestamp.getTime())) throw new Error("The database entry-pass timestamp is invalid.");
  return timestamp.toISOString();
}

function databaseEntryPassPepper() {
  const value = process.env.DATABASE_ENTRY_PASS_TOKEN_PEPPER?.trim();
  if (!value) throw new Error("DATABASE_ENTRY_PASS_TOKEN_PEPPER is not configured.");
  return value;
}

/**
 * Derive a stable 256-bit pass from a private invitation token and a stored,
 * non-secret version UUID. This lets a guest reload their page and recover the
 * same QR code without storing either raw credential in PostgreSQL. Rotating
 * the version UUID creates a completely new pass when attendance returns.
 */
export function deriveDatabaseEntryPassToken(invitationToken: string, passVersion: string) {
  return createHmac("sha256", databaseEntryPassPepper())
    .update(`${ENTRY_PASS_KEY_CONTEXT}\u0000token\u0000${passVersion}\u0000${invitationToken}`)
    .digest("base64url");
}

/** Store a different domain-separated HMAC digest for token lookup at scan time. */
export function databaseEntryPassTokenDigest(passToken: string) {
  return createHmac("sha256", databaseEntryPassPepper())
    .update(`${ENTRY_PASS_KEY_CONTEXT}\u0000digest\u0000${passToken}`)
    .digest("hex");
}

function parseAttendances(value: unknown): AttendanceInput[] | null {
  const parsed = persistedAttendanceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function hasDatabaseEntryPassEligibility(status: RSVPStatus, attendances: unknown) {
  if (status !== "attending") return false;
  return parseAttendances(attendances)?.some((attendance) => attendance.attending && attendance.adults + attendance.children > 0) ?? false;
}

export function databaseEntryAttendanceForEvent(status: RSVPStatus, attendances: unknown, eventId: string) {
  if (status !== "attending") return null;
  const attendance = parseAttendances(attendances)?.find((candidate) => candidate.eventId === eventId);
  if (!attendance || !attendance.attending || attendance.adults + attendance.children === 0) return null;
  return { adults: attendance.adults, children: attendance.children };
}

function toEntryPass(invitationToken: string, row: DatabaseEntryPassRow): EntryPass {
  if (row.status !== "active") throw new Error("An inactive entry pass cannot be shown to a guest.");
  const token = deriveDatabaseEntryPassToken(invitationToken, row.pass_version);
  return {
    qrPayload: createEntryPassPayload(token),
    state: row.first_checked_in_at ? "checked-in" : "ready",
    issuedAt: normalizeTimestamp(row.issued_at),
    checkedInAt: row.first_checked_in_at ? normalizeTimestamp(row.first_checked_in_at) : null
  };
}

/**
 * A pass version alone is not enough to reconstruct a credential if the
 * server-only derivation key changes. Compare the reconstructed lookup digest
 * before showing an existing pass so a newly configured/rotated pepper cannot
 * make the guest page render a QR that the scanner will never find.
 */
function matchesStoredEntryPassDigest(passToken: string, storedDigest: string) {
  const computedDigest = databaseEntryPassTokenDigest(passToken);
  if (!/^[0-9a-f]{64}$/.test(storedDigest)) return false;
  return timingSafeEqual(
    Buffer.from(computedDigest, "hex"),
    Buffer.from(storedDigest, "hex")
  );
}

type ActivePassQueryRow = DatabaseEntryPassRow;

/**
 * Synchronise the only currently usable QR pass while the caller holds an
 * UPDATE lock on `wedding.invitations`. This lock order is shared by RSVP save,
 * resolver recovery, revocation, and scanner code to avoid a revoke/scan race.
 */
export async function syncDatabaseEntryPassInTransaction(
  client: PoolClient,
  input: {
    invitationId: string;
    invitationToken: string;
    side?: WeddingSide;
    rsvp: DatabaseRsvpForPass | null;
  }
): Promise<EntryPass | null> {
  const side = requireWeddingSide(input.side ?? "groom");
  const eligible = input.rsvp
    ? hasDatabaseEntryPassEligibility(input.rsvp.status, input.rsvp.attendances)
    : false;

  const { rows: existingRows } = await client.query<ActivePassQueryRow>(
    `select
       passes.id,
       passes.invitation_id,
       passes.token_hash,
       passes.pass_version,
       passes.status,
       passes.issued_at,
       passes.invalidated_at,
       (
         select min(check_ins.checked_in_at)
           from wedding.entry_check_ins as check_ins
          where check_ins.entry_pass_id = passes.id
       ) as first_checked_in_at
     from wedding.entry_passes as passes
    where passes.invitation_id = $1
      and exists (select 1 from wedding.invitations where id = passes.invitation_id and side = $2)
      and passes.status = 'active'
    order by passes.issued_at desc
    limit 1
    for update`,
    [input.invitationId, side]
  );
  const existing = existingRows[0];

  if (!eligible) {
    if (existing) {
      await client.query(
        `update wedding.entry_passes
            set status = 'invalidated',
                invalidated_at = coalesce(invalidated_at, now()),
                invalidation_reason = coalesce(invalidation_reason, 'rsvp_no_longer_attending')
          where id = $1
            and status = 'active'`,
        [existing.id]
      );
    }
    return null;
  }

  if (existing) {
    const reconstructedToken = deriveDatabaseEntryPassToken(input.invitationToken, existing.pass_version);
    if (matchesStoredEntryPassDigest(reconstructedToken, existing.token_hash)) {
      return toEntryPass(input.invitationToken, existing);
    }

    // The QR pepper was added or rotated after this row was issued (or the
    // row is otherwise inconsistent). Keep the old row for audit purposes,
    // invalidate it under the invitation lock, then issue a fresh version with
    // the currently configured key below. This fails closed rather than
    // returning a QR that cannot be looked up by the scanner.
    await invalidateDatabaseEntryPassesInTransaction(client, input.invitationId, "entry_pass_key_changed", side);
  }

  // The version is not a secret. Its only job is to make a returned-to-
  // attending RSVP get a fresh, unrecoverable-from-the-old-QR credential.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const passVersion = randomUUID();
    const passToken = deriveDatabaseEntryPassToken(input.invitationToken, passVersion);
    try {
      const { rows } = await client.query<DatabaseEntryPassInsertRow>(
        `insert into wedding.entry_passes (
           id, invitation_id, token_hash, pass_version, status
         ) select $1, $2, $3, $4, 'active'
           where exists (select 1 from wedding.invitations where id = $2 and side = $5)
         returning id, invitation_id, token_hash, pass_version, status, issued_at, invalidated_at`,
        [randomUUID(), input.invitationId, databaseEntryPassTokenDigest(passToken), passVersion, side]
      );
      const created = rows[0];
      if (!created) throw new Error("The entry pass was not saved.");
      return toEntryPass(input.invitationToken, { ...created, first_checked_in_at: null });
    } catch (error) {
      // Both the random row id and 256-bit-derived pass digest are unique. A
      // retry keeps the collision path safe without ever overwriting a pass.
      if (typeof error === "object" && error && "code" in error && error.code === "23505") continue;
      throw error;
    }
  }

  throw new Error("Could not allocate a unique entry pass.");
}

/** Mark every usable pass for a household unavailable, preserving scan audit rows. */
export async function invalidateDatabaseEntryPassesInTransaction(
  client: PoolClient,
  invitationId: string,
  reason: "invitation_revoked" | "rsvp_no_longer_attending" | "rsvp_deleted" | "entry_pass_key_changed",
  side: WeddingSide = "groom"
) {
  requireWeddingSide(side);
  await client.query(
    `update wedding.entry_passes
        set status = 'invalidated',
            invalidated_at = coalesce(invalidated_at, now()),
            invalidation_reason = coalesce(invalidation_reason, $2)
      where invitation_id = $1
        and exists (select 1 from wedding.invitations where id = $1 and side = $3)
        and status = 'active'`,
    [invitationId, reason, side]
  );
}
