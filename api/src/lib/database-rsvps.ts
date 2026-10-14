import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import { attachDatabasePool } from "@vercel/functions";
import { Client, Pool, type PoolClient } from "pg";

import { rsvpSubmissionSchema } from "../domain/rsvp.js";
import { databaseEnvironmentRequestsVerifiedTls, databaseUrlConfiguration } from "./database-configuration.js";
import { syncDatabaseEntryPassInTransaction } from "./database-entry-passes.js";
import { isLocalStackDatabase } from "./local-stack.js";
import { hasConfiguredCanonicalPublicOrigin } from "./public-origin.js";
import type { EntryPass, RSVPInput, RSVPRecord } from "../domain/types.js";

type DatabaseRsvpRow = {
  respondent_name: string;
  status: RSVPInput["status"];
  attendances: unknown;
  comfort_note: string | null;
  decline_message: string | null;
  updated_at: Date | string;
};

type TimestampRow = Pick<DatabaseRsvpRow, "updated_at">;

type LockedDatabaseInvitationRow = {
  id: string;
  token_hash: string;
};

type DatabaseRsvpWindowRow = {
  can_edit_until: Date | string;
};

export type DatabaseRsvpSaveResult = {
  record: RSVPRecord;
  /** Present only while the newly saved RSVP is eligible for an entry pass. */
  entryPass: EntryPass | null;
};

const DATABASE_RSVP_CUTOFF_ERROR = "Online RSVP is closed.";

/** A user-safe outcome when the authoritative database cutoff has passed. */
export class DatabaseRsvpClosedError extends Error {
  constructor() {
    super("Online RSVPs are now closed. Please contact the coordination desk.");
    this.name = "DatabaseRsvpClosedError";
  }
}

function isDatabaseRsvpCutoffError(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && "message" in error
    && error.code === "23514"
    && error.message === DATABASE_RSVP_CUTOFF_ERROR;
}

type DatabasePoolGlobal = typeof globalThis & {
  __shaadiCompanionDatabaseRsvpPool?: Pool;
  __shaadiCompanionDatabaseRsvpPoolUrl?: string;
};

// node-postgres exposes this parsed state at runtime, but does not include it
// in its public TypeScript surface. Keep the narrow internal shape here so the
// safety check does not depend on untyped `any` values.
type ParsedPgConnection = {
  connectionParameters: {
    host: string;
    isDomainSocket: boolean;
    ssl: boolean | { rejectUnauthorized?: boolean } | undefined;
  };
};

function requiresProductionDatabaseProtections() {
  return process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test";
}

function databaseConnectionString() {
  const { connectionString } = databaseUrlConfiguration();
  const productionProtectionsRequired = requiresProductionDatabaseProtections();
  const localStackDatabase = isLocalStackDatabase();

  // Reject an unsafe deployment URL before letting node-postgres parse it.
  // Besides being cheaper, this avoids treating a weaker SSL mode as a valid
  // configuration at any point in the connection setup.
  if (
    productionProtectionsRequired
    && !localStackDatabase
    && (!hasConfiguredCanonicalPublicOrigin() || !databaseEnvironmentRequestsVerifiedTls())
  ) {
    throw new Error("Production database access requires a canonical HTTPS public origin and verified TLS.");
  }

  // `pg` accepts several connection-string aliases. Probe its final parsed
  // state before opening a socket, rather than trusting a visually similar URL.
  const probe = new Client({ connectionString }) as Client & ParsedPgConnection;
  const host = probe.connectionParameters.host.replace(/^\[([^\]]+)\]$/, "$1");
  if (probe.connectionParameters.isDomainSocket || !host) {
    throw new Error("DATABASE_URL must use a TCP PostgreSQL host.");
  }

  if (!productionProtectionsRequired) {
    if (isIP(host) === 0 || (host !== "127.0.0.1" && host !== "::1")) {
      throw new Error("DATABASE_URL must point to a 127.0.0.1 or ::1 PostgreSQL database during development and tests.");
    }
  } else if (!localStackDatabase) {
    const ssl = probe.connectionParameters.ssl;
    if (
      !ssl
      || (typeof ssl === "object" && ssl.rejectUnauthorized === false)
    ) {
      throw new Error("Production database access requires a canonical HTTPS public origin and verified TLS.");
    }
  }
  return connectionString;
}

function databaseTokenPepper() {
  const value = process.env.DATABASE_INVITATION_TOKEN_PEPPER;
  if (!value) throw new Error("DATABASE_INVITATION_TOKEN_PEPPER is not configured.");
  return value;
}

/**
 * Store only an HMAC digest in the direct database and keep bearer tokens out
 * of SQL rows.
 */
export function databaseInvitationTokenDigest(token: string) {
  return createHmac("sha256", databaseTokenPepper()).update(token).digest("hex");
}

/**
 * Shared, server-only connection pool for the direct PostgreSQL adapter. Keep
 * callers inside `src/lib/server`; browser code must never reach the database
 * or either token pepper.
 */
export function getDatabasePool() {
  const connectionString = databaseConnectionString();
  const globalForPool = globalThis as DatabasePoolGlobal;
  if (
    globalForPool.__shaadiCompanionDatabaseRsvpPool &&
    globalForPool.__shaadiCompanionDatabaseRsvpPoolUrl === connectionString
  ) {
    return globalForPool.__shaadiCompanionDatabaseRsvpPool;
  }

  // A bounded pool limits a compromised route's connection fan-out. It is
  // intentionally server-only, and idle pools do not hold test processes open.
  const pool = new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 10_000,
    // Neon can need time to resume its compute before opening a connection.
    // Keep executed queries bounded independently from connection acquisition.
    connectionTimeoutMillis: process.env.VERCEL === "1" ? 15_000 : 4_000,
    query_timeout: 4_000,
    allowExitOnIdle: true
  });
  // Fluid compute suspends instances between requests. Register each pool
  // once so Vercel can release idle clients before suspension; local Node
  // processes continue using node-postgres's normal idle timer.
  if (process.env.VERCEL === "1") attachDatabasePool(pool);
  const previousPool = globalForPool.__shaadiCompanionDatabaseRsvpPool;
  globalForPool.__shaadiCompanionDatabaseRsvpPool = pool;
  globalForPool.__shaadiCompanionDatabaseRsvpPoolUrl = connectionString;
  if (previousPool) void previousPool.end();
  return pool;
}

function normalizeTimestamp(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("The database RSVP timestamp is invalid.");
  return date.toISOString();
}

/**
 * Give a request that crosses the cutoff a useful response instead of a
 * generic database error. The trigger repeats this immediately before the
 * insert/update, so a clock change after this read still fails closed.
 */
async function requireDatabaseRsvpWindowOpen(client: PoolClient) {
  const { rows } = await client.query<DatabaseRsvpWindowRow>(
    `select can_edit_until
       from wedding.settings
      where id = 1
      limit 1`
  );
  const cutoff = rows[0]?.can_edit_until;
  const cutoffTime = cutoff instanceof Date ? cutoff.getTime() : Date.parse(cutoff ?? "");
  if (!Number.isFinite(cutoffTime)) throw new Error("The RSVP cutoff is invalid.");
  if (cutoffTime <= Date.now()) throw new DatabaseRsvpClosedError();
}

function rowToRecord(token: string, row: DatabaseRsvpRow): RSVPRecord {
  const parsed = rsvpSubmissionSchema.safeParse({
    token,
    respondentName: row.respondent_name,
    status: row.status,
    attendances: row.attendances,
    comfortNote: row.comfort_note ?? undefined,
    declineMessage: row.decline_message ?? undefined
  });
  if (!parsed.success) throw new Error("The database RSVP record is invalid.");

  return {
    ...parsed.data,
    updatedAt: normalizeTimestamp(row.updated_at)
  };
}

/** Load a prior RSVP without ever querying by, or returning, its raw token. */
export async function loadDatabaseRSVP(token: string): Promise<RSVPRecord | null> {
  const { rows } = await getDatabasePool().query<DatabaseRsvpRow>(
    `select respondent_name, status, attendances, comfort_note, decline_message, updated_at
       from wedding.rsvps
      where token_hash = $1
      limit 1`,
    [databaseInvitationTokenDigest(token)]
  );
  return rows[0] ? rowToRecord(token, rows[0]) : null;
}

/**
 * Atomically replace the current database RSVP snapshot. The route has already
 * performed invitation-specific validation; this validates the stored shape a
 * second time so direct callers cannot write untrusted JSON to Postgres.
 */
export async function saveDatabaseRSVP(input: RSVPInput): Promise<DatabaseRsvpSaveResult> {
  const parsed = rsvpSubmissionSchema.safeParse(input);
  if (!parsed.success) throw new Error("The database RSVP payload is invalid.");

  const tokenHash = databaseInvitationTokenDigest(parsed.data.token);
  const client = await getDatabasePool().connect();
  let transactionOpen = false;

  try {
    await client.query("begin");
    transactionOpen = true;

    // Every write that can affect a pass begins by locking the invitation.
    // Revocation and entry scanning take the same lock, so an RSVP can never
    // create a usable pass after the link was disabled.
    const { rows: invitationRows } = await client.query<LockedDatabaseInvitationRow>(
      `select id, token_hash
         from wedding.invitations
        where token_hash = $1
          and status = 'active'
          and access_expires_at > now()
        for update`,
      [tokenHash]
    );
    const invitation = invitationRows[0];
    if (!invitation) throw new Error("The invitation is no longer active.");

    await requireDatabaseRsvpWindowOpen(client);

    const { rows } = await client.query<TimestampRow>(
      `insert into wedding.rsvps (
         token_hash, respondent_name, status, attendances, comfort_note, decline_message
       ) values ($1, $2, $3, $4::jsonb, $5, $6)
       on conflict (token_hash) do update set
         respondent_name = excluded.respondent_name,
         status = excluded.status,
         attendances = excluded.attendances,
         comfort_note = excluded.comfort_note,
         decline_message = excluded.decline_message,
         updated_at = now()
       returning updated_at`,
      [
        invitation.token_hash,
        parsed.data.respondentName,
        parsed.data.status,
        JSON.stringify(parsed.data.attendances),
        parsed.data.comfortNote ?? null,
        parsed.data.declineMessage ?? null
      ]
    );
    const timestamp = rows[0]?.updated_at;
    if (!timestamp) throw new Error("The RSVP was not saved.");

    const entryPass = await syncDatabaseEntryPassInTransaction(client, {
      invitationId: invitation.id,
      invitationToken: parsed.data.token,
      rsvp: { status: parsed.data.status, attendances: parsed.data.attendances }
    });

    await client.query("commit");
    transactionOpen = false;
    return {
      record: {
        ...parsed.data,
        updatedAt: normalizeTimestamp(timestamp)
      },
      entryPass
    };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the original database error for the route's generic error.
      }
    }
    if (isDatabaseRsvpCutoffError(error)) throw new DatabaseRsvpClosedError();
    throw error;
  } finally {
    client.release();
  }
}

/** Test teardown helper for the module-scoped database connection pool. */
export async function resetDatabaseRsvpPoolForTest() {
  const globalForPool = globalThis as DatabasePoolGlobal;
  const pool = globalForPool.__shaadiCompanionDatabaseRsvpPool;
  globalForPool.__shaadiCompanionDatabaseRsvpPool = undefined;
  globalForPool.__shaadiCompanionDatabaseRsvpPoolUrl = undefined;
  if (pool) await pool.end();
}
