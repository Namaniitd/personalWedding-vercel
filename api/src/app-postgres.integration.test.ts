import { Client } from "pg";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { handleApiRequest } from "./app";
import { parseEntryPassPayload } from "./domain/entry-pass";
import { databaseEntryPassTokenDigest } from "./lib/database-entry-passes";
import { resolveInvitation } from "./lib/invitations";
import { listDatabaseCoordinatorInvitations } from "./lib/database-invitations";
import {
  DatabaseRsvpClosedError,
  getDatabasePool,
  databaseInvitationTokenDigest,
  resetDatabaseRsvpPoolForTest,
  saveDatabaseRSVP
} from "./lib/database-rsvps";
import { resetRateLimitsForTest } from "./lib/rate-limit";
import { loadDatabaseWeddingConfiguration } from "./lib/database-wedding-content";

// node-postgres exposes these parsed parameters at runtime, but its public
// TypeScript declaration omits them. Keep the safety check narrowly typed.
type ParsedPgConnection = {
  connectionParameters: {
    host: string;
    isDomainSocket: boolean;
  };
};

function hasExplicitLoopbackTestDatabase() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return false;

  try {
    // pg permits a `?host=` override, so inspect its effective connection
    // parameters instead of trusting the hostname text in the URL.
    const client = new Client({ connectionString }) as Client & ParsedPgConnection;
    const host = client.connectionParameters.host.replace(/^\[([^\]]+)\]$/, "$1");
    return !client.connectionParameters.isDomainSocket
      && (host === "127.0.0.1" || host === "::1");
  } catch {
    return false;
  }
}

const hasDatabase = process.env.RUN_DATABASE_TESTS === "true"
  && Boolean(process.env.DATABASE_URL)
  && Boolean(process.env.DATABASE_INVITATION_TOKEN_PEPPER)
  && Boolean(process.env.DATABASE_ENTRY_PASS_TOKEN_PEPPER)
  && hasExplicitLoopbackTestDatabase();
const databaseDescribe = hasDatabase ? describe : describe.skip;

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://api.internal${path.replace(/^\/api\//, "/v1/")}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Backend-Service-Token": "integration-service-token-abcdefghijklmnopqrstuvwxyz"
    },
    body: JSON.stringify(body)
  });
}

const issueInvitation = handleApiRequest;
const revokeInvitation = handleApiRequest;
const deleteRsvp = handleApiRequest;
const checkInEntryPass = handleApiRequest;
const submitRsvp = handleApiRequest;

databaseDescribe("database Postgres invitation flow", () => {
  let tokenHash: string | null = null;
  let selectedEventId: string;
  let unselectedEventId: string;
  let rsvpDeadlineAt: string;

  beforeAll(async () => {
    // These tests deliberately use the configured database schedule rather
    // than inserting a fixture. `RUN_DATABASE_TESTS` must therefore
    // point at a disposable loopback database with reviewed configuration and
    // an open RSVP window.
    const configuration = await loadDatabaseWeddingConfiguration();
    const selected = configuration.events[0]?.event;
    if (!selected) throw new Error("Database integration tests require one published event.");
    if (new Date(configuration.rsvpDeadlineIso).getTime() <= Date.now()) {
      throw new Error("Database integration tests require an open RSVP window.");
    }
    rsvpDeadlineAt = configuration.rsvpDeadlineAt;
    selectedEventId = selected.id;
    unselectedEventId = configuration.events[1]?.event.id ?? "unselected-event";
  });

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PUBLIC_APP_ORIGIN", undefined);
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("INVITATION_TOKEN_PEPPER", "");
    vi.stubEnv("ENTRY_PASS_TOKEN_PEPPER", "");
    vi.stubEnv("BACKEND_SERVICE_TOKEN", "integration-service-token-abcdefghijklmnopqrstuvwxyz");
  });

  afterEach(async () => {
    if (tokenHash) {
      const pool = getDatabasePool();
      // The database itself permits RSVP erasure only after revocation, so
      // teardown follows the same lifecycle even when an assertion fails
      // before this test reaches its ordinary revoke step.
      await pool.query(
        `update wedding.invitations
            set status = 'revoked', revoked_at = coalesce(revoked_at, now())
          where token_hash = $1`,
        [tokenHash]
      );
      await pool.query("delete from wedding.rsvps where token_hash = $1", [tokenHash]);
      await pool.query(
        `delete from wedding.entry_check_ins
          where entry_pass_id in (
            select id from wedding.entry_passes
             where invitation_id in (select id from wedding.invitations where token_hash = $1)
          )`,
        [tokenHash]
      );
      await pool.query(
        `delete from wedding.entry_passes
          where invitation_id in (select id from wedding.invitations where token_hash = $1)`,
        [tokenHash]
      );
      await pool.query("delete from wedding.coordinator_rsvp_audit where invitation_id in (select id from wedding.invitations where token_hash = $1)", [tokenHash]);
      await pool.query("delete from wedding.invitations where token_hash = $1", [tokenHash]);
      tokenHash = null;
    }
    resetRateLimitsForTest();
    await resetDatabaseRsvpPoolForTest();
    vi.unstubAllEnvs();
  });

  it("issues a digest-only link, retains revocation audit, then permanently erases its RSVP", async () => {
    resetRateLimitsForTest();
    const householdNameEn = `Portal Test ${Date.now()}`;
    const issuedResponse = await issueInvitation(jsonRequest("/api/coordinator/invitations", {
      householdNameEn,
      householdNameHi: "",
      preferredLocale: "en",
      contactRole: "groom",
      eventLimits: [{ eventId: selectedEventId, adults: 2, children: 1 }]
    }));
    expect(issuedResponse.status).toBe(200);
    const { issued } = await issuedResponse.json() as { issued: {
      id: string;
      createdAt: string;
      token: string;
      householdName: { en: string; hi: string };
      eventCount: number;
      contactRole: "groom" | "bride";
    } };
    expect(issued.id).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
    expect(issued.createdAt).toEqual(expect.any(String));
    expect(issued.contactRole).toBe("groom");
    const token = issued.token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (!token) throw new Error("The database issuer did not return a token.");
    tokenHash = databaseInvitationTokenDigest(token);

    const pool = getDatabasePool();
    const stored = await pool.query<{
      token_hash: string;
      household_name_en: string;
      household_name_hi: string;
      contact_role: "groom" | "bride";
      event_limits: unknown;
      access_expires_at: Date | string;
    }>(
      "select token_hash, household_name_en, household_name_hi, contact_role, event_limits, access_expires_at from wedding.invitations where token_hash = $1",
      [tokenHash]
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.token_hash).toBe(tokenHash);
    expect(stored.rows[0]?.household_name_en).toBe(householdNameEn);
    expect(stored.rows[0]?.household_name_hi).toBe(householdNameEn);
    expect(stored.rows[0]?.contact_role).toBe("groom");
    expect(new Date(stored.rows[0]?.access_expires_at ?? "").toISOString())
      .toBe(new Date(Date.parse(rsvpDeadlineAt) + 90 * 24 * 60 * 60 * 1_000).toISOString());
    expect(JSON.stringify(stored.rows[0])).not.toContain(token);

    const columnNames = await pool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'wedding' and table_name = 'invitations'"
    );
    expect(columnNames.rows.map((row) => row.column_name)).not.toContain("token");
    expect(columnNames.rows.map((row) => row.column_name)).not.toContain("invitation_url");

    const resolvedBeforeRsvp = await resolveInvitation(token);
    expect(resolvedBeforeRsvp).toMatchObject({
      invitation: {
        householdName: { en: householdNameEn, hi: householdNameEn },
        eventLimits: { [selectedEventId]: { adults: 2, children: 1 } }
      },
      events: [{ id: selectedEventId }],
      rsvp: null
    });

    const rsvpResponse = await submitRsvp(jsonRequest("/api/rsvp", {
      token,
      respondentName: "Portal Test Guest",
      status: "attending",
      attendances: [{ eventId: selectedEventId, attending: true, adults: 2, children: 1 }]
    }));
    expect(rsvpResponse.status).toBe(200);
    await expect(rsvpResponse.json()).resolves.toMatchObject({ ok: true, mode: "database" });

    const resolvedAfterRsvp = await resolveInvitation(token);
    expect(resolvedAfterRsvp?.rsvp).toMatchObject({
      respondentName: "Portal Test Guest",
      status: "attending",
      attendances: [{ eventId: selectedEventId, attending: true, adults: 2, children: 1 }]
    });

    // The route refuses to begin an erasure while the bearer link can still
    // be used, and the DB trigger independently rejects a direct delete.
    const activeDeleteResponse = await deleteRsvp(jsonRequest("/api/coordinator/invitations/rsvp/delete", {
      invitationId: issued.id
    }));
    expect(activeDeleteResponse.status).toBe(409);
    await expect(activeDeleteResponse.json()).resolves.toEqual({
      error: "Disable this invitation before deleting its RSVP."
    });
    await expect(pool.query("delete from wedding.rsvps where token_hash = $1", [tokenHash]))
      .rejects.toMatchObject({ code: "23514" });

    const revokedResponse = await revokeInvitation(jsonRequest("/api/coordinator/invitations/revoke", {
      invitationId: issued.id
    }));
    expect(revokedResponse.status).toBe(200);
    const revoked = await revokedResponse.json() as {
      ok: boolean;
      invitationId: string;
      revokedAt: string;
    };
    expect(revoked).toMatchObject({ ok: true, invitationId: issued.id });
    expect(new Date(revoked.revokedAt).getTime()).toBeGreaterThan(0);

    // Retrying after a browser/network interruption must not resurrect the
    // link or produce a different audit timestamp.
    const repeatedRevocation = await revokeInvitation(jsonRequest("/api/coordinator/invitations/revoke", {
      invitationId: issued.id
    }));
    expect(repeatedRevocation.status).toBe(200);
    await expect(repeatedRevocation.json()).resolves.toEqual(revoked);

    // A revoked bearer token cannot resolve, but its RSVP remains until an
    // explicit coordinator erasure, while the invitation audit stays intact.
    expect(await resolveInvitation(token)).toBeNull();
    const revokedRow = await pool.query<{
      status: "active" | "revoked";
      revoked_at: Date | string | null;
    }>("select status, revoked_at from wedding.invitations where token_hash = $1", [tokenHash]);
    expect(revokedRow.rows).toHaveLength(1);
    expect(revokedRow.rows[0]).toMatchObject({ status: "revoked" });
    expect(revokedRow.rows[0]?.revoked_at).not.toBeNull();

    const retainedRsvp = await pool.query<{ status: string }>(
      "select status from wedding.rsvps where token_hash = $1",
      [tokenHash]
    );
    expect(retainedRsvp.rows).toEqual([{ status: "attending" }]);

    const retainedCoordinatorSummary = (await listDatabaseCoordinatorInvitations()).find((entry) => entry.id === issued.id);
    expect(retainedCoordinatorSummary).toMatchObject({
      id: issued.id,
      householdName: { en: householdNameEn, hi: householdNameEn },
      contactRole: "groom",
      status: "revoked",
      revokedAt: revoked.revokedAt,
      rsvp: { status: "attending" }
    });
    expect(retainedCoordinatorSummary?.rsvpDeletedAt).toBeNull();

    const deleteResponse = await deleteRsvp(jsonRequest("/api/coordinator/invitations/rsvp/delete", {
      invitationId: issued.id
    }));
    expect(deleteResponse.status).toBe(200);
    const erased = await deleteResponse.json() as {
      ok: boolean;
      invitationId: string;
      rsvpDeletedAt: string;
    };
    expect(erased).toMatchObject({ ok: true, invitationId: issued.id });
    expect(new Date(erased.rsvpDeletedAt).getTime()).toBeGreaterThan(0);

    // The browser can safely retry a completed destructive action without a
    // second timestamp or any response content being restored.
    const repeatedDeletion = await deleteRsvp(jsonRequest("/api/coordinator/invitations/rsvp/delete", {
      invitationId: issued.id
    }));
    expect(repeatedDeletion.status).toBe(200);
    await expect(repeatedDeletion.json()).resolves.toEqual(erased);

    const deletedRsvp = await pool.query<{ status: string }>(
      "select status from wedding.rsvps where token_hash = $1",
      [tokenHash]
    );
    expect(deletedRsvp.rows).toEqual([]);

    const retainedInvitation = await pool.query<{
      status: "active" | "revoked";
      revoked_at: Date | string | null;
      rsvp_deleted_at: Date | string | null;
    }>("select status, revoked_at, rsvp_deleted_at from wedding.invitations where token_hash = $1", [tokenHash]);
    expect(retainedInvitation.rows).toHaveLength(1);
    expect(retainedInvitation.rows[0]).toMatchObject({ status: "revoked" });
    expect(retainedInvitation.rows[0]?.revoked_at).not.toBeNull();
    expect(new Date(retainedInvitation.rows[0]?.rsvp_deleted_at ?? "").toISOString())
      .toBe(erased.rsvpDeletedAt);

    const deletedCoordinatorSummary = (await listDatabaseCoordinatorInvitations()).find((entry) => entry.id === issued.id);
    expect(deletedCoordinatorSummary).toMatchObject({
      id: issued.id,
      status: "revoked",
      revokedAt: revoked.revokedAt,
      rsvpDeletedAt: erased.rsvpDeletedAt,
      rsvp: null
    });
    expect(JSON.stringify(deletedCoordinatorSummary)).not.toContain(token);
    expect(Object.keys(deletedCoordinatorSummary ?? {})).not.toContain("token");
    expect(Object.keys(deletedCoordinatorSummary ?? {})).not.toContain("tokenHash");
  });

  it("enforces the RSVP cutoff in the direct adapter and for direct database inserts and updates", async () => {
    resetRateLimitsForTest();
    const issuedResponse = await issueInvitation(jsonRequest("/api/coordinator/invitations", {
      householdNameEn: `Cutoff Test ${Date.now()}`,
      householdNameHi: "",
      preferredLocale: "en",
      contactRole: "groom",
      eventLimits: [{ eventId: selectedEventId, adults: 2, children: 0 }]
    }));
    expect(issuedResponse.status).toBe(200);
    const { issued } = await issuedResponse.json() as { issued: { token: string } };
    const token = issued.token;
    if (!token) throw new Error("The database issuer did not return a token.");
    tokenHash = databaseInvitationTokenDigest(token);

    const pool = getDatabasePool();
    const { rows: settingsRows } = await pool.query<{ can_edit_until: Date | string }>(
      "select can_edit_until from wedding.settings where id = 1"
    );
    const originalCanEditUntil = settingsRows[0]?.can_edit_until;
    if (!originalCanEditUntil) throw new Error("Database integration tests require an RSVP cutoff.");

    const rsvp = {
      token,
      respondentName: "Cutoff Test Guest",
      status: "attending" as const,
      attendances: [{ eventId: selectedEventId, attending: true, adults: 2, children: 0 }]
    };

    try {
      await pool.query(
        "update wedding.settings set can_edit_until = clock_timestamp() - interval '1 second' where id = 1"
      );

      // The table trigger remains authoritative even if a caller bypasses the
      // app's adapter and attempts a direct write.
      await expect(pool.query(
        `insert into wedding.rsvps (token_hash, respondent_name, status, attendances)
         values ($1, $2, 'declined', '[]'::jsonb)`,
        [tokenHash, "Cutoff Test Guest"]
      )).rejects.toMatchObject({ code: "23514", message: "Online RSVP is closed." });
      await expect(saveDatabaseRSVP(rsvp)).rejects.toBeInstanceOf(DatabaseRsvpClosedError);

      await pool.query("update wedding.settings set can_edit_until = $1 where id = 1", [originalCanEditUntil]);
      await expect(saveDatabaseRSVP(rsvp)).resolves.toMatchObject({
        record: { respondentName: "Cutoff Test Guest", status: "attending" }
      });

      await pool.query(
        "update wedding.settings set can_edit_until = clock_timestamp() - interval '1 second' where id = 1"
      );
      await expect(pool.query(
        "update wedding.rsvps set respondent_name = $2 where token_hash = $1",
        [tokenHash, "Late Cutoff Test Guest"]
      )).rejects.toMatchObject({ code: "23514", message: "Online RSVP is closed." });
    } finally {
      await pool.query("update wedding.settings set can_edit_until = $1 where id = 1", [originalCanEditUntil]);
    }
  });

  it("derives a reloadable household QR and records one admission per selected configured event", async () => {
    resetRateLimitsForTest();
    const householdNameEn = `Gate Test ${Date.now()}`;
    const issuedResponse = await issueInvitation(jsonRequest("/api/coordinator/invitations", {
      householdNameEn,
      householdNameHi: "",
      preferredLocale: "en",
      contactRole: "groom",
      eventLimits: [{ eventId: selectedEventId, adults: 2, children: 1 }]
    }));
    expect(issuedResponse.status).toBe(200);
    const { issued } = await issuedResponse.json() as { issued: { id: string; token: string } };
    const token = issued.token;
    if (!token) throw new Error("The database issuer did not return a token.");
    tokenHash = databaseInvitationTokenDigest(token);

    const rsvpResponse = await submitRsvp(jsonRequest("/api/rsvp", {
      token,
      respondentName: "Gate Test Guest",
      status: "attending",
      attendances: [{ eventId: selectedEventId, attending: true, adults: 2, children: 1 }]
    }));
    expect(rsvpResponse.status).toBe(200);
    const saved = await rsvpResponse.json() as {
      ok: boolean;
      entryPass: { qrPayload: string; state: string; checkedInAt: string | null } | null;
    };
    expect(saved).toMatchObject({ ok: true, entryPass: { state: "ready", checkedInAt: null } });
    const firstPayload = saved.entryPass?.qrPayload;
    expect(firstPayload).toMatch(/^shaadi-entry:v1:[A-Za-z0-9_-]{43}$/);
    if (!firstPayload) throw new Error("An attending RSVP did not receive an entry pass.");
    const firstPassToken = parseEntryPassPayload(firstPayload);
    if (!firstPassToken) throw new Error("The entry payload could not be parsed.");

    // The page can reconstruct the same QR later without a raw QR value in SQL.
    const reloaded = await resolveInvitation(token);
    expect(reloaded?.entryPass?.qrPayload).toBe(firstPayload);
    expect(reloaded?.entryPass?.state).toBe("ready");

    const wrongEvent = await checkInEntryPass(jsonRequest("/api/coordinator/check-in", {
      passToken: firstPassToken,
      eventId: unselectedEventId
    }));
    expect(wrongEvent.status).toBe(422);
    const wrongEventBody = await wrongEvent.json();
    expect(wrongEventBody).toMatchObject({ code: "not_eligible" });
    expect(JSON.stringify(wrongEventBody)).not.toContain(householdNameEn);

    const firstSelectedEventScan = await checkInEntryPass(jsonRequest("/api/coordinator/check-in", {
      passToken: firstPassToken,
      eventId: selectedEventId
    }));
    expect(firstSelectedEventScan.status).toBe(200);
    await expect(firstSelectedEventScan.json()).resolves.toMatchObject({
      outcome: "checked_in",
      householdName: householdNameEn,
      event: { id: selectedEventId },
      expectedAdults: 2,
      expectedChildren: 1,
      scanCount: 1
    });

    const repeatedSelectedEventScan = await checkInEntryPass(jsonRequest("/api/coordinator/check-in", {
      passToken: firstPassToken,
      eventId: selectedEventId
    }));
    expect(repeatedSelectedEventScan.status).toBe(200);
    await expect(repeatedSelectedEventScan.json()).resolves.toMatchObject({
      outcome: "already_checked_in",
      scanCount: 2
    });

    // A decline invalidates the currently active pass immediately. Returning
    // to attending allocates a rotated QR, so a screenshot of the old code
    // cannot be used after the RSVP changed.
    const declined = await submitRsvp(jsonRequest("/api/rsvp", {
      token,
      respondentName: "Gate Test Guest",
      status: "declined",
      attendances: [{ eventId: selectedEventId, attending: false, adults: 0, children: 0 }]
    }));
    expect(declined.status).toBe(200);
    await expect(declined.json()).resolves.toMatchObject({ ok: true, entryPass: null });
    expect((await resolveInvitation(token))?.entryPass).toBeUndefined();

    const staleScan = await checkInEntryPass(jsonRequest("/api/coordinator/check-in", {
      passToken: firstPassToken,
      eventId: selectedEventId
    }));
    expect(staleScan.status).toBe(404);

    const attendingAgain = await submitRsvp(jsonRequest("/api/rsvp", {
      token,
      respondentName: "Gate Test Guest",
      status: "attending",
      attendances: [{ eventId: selectedEventId, attending: true, adults: 1, children: 0 }]
    }));
    expect(attendingAgain.status).toBe(200);
    const returned = await attendingAgain.json() as { entryPass: { qrPayload: string } | null };
    expect(returned.entryPass?.qrPayload).toMatch(/^shaadi-entry:v1:/);
    expect(returned.entryPass?.qrPayload).not.toBe(firstPayload);
    const returnedPassToken = returned.entryPass && parseEntryPassPayload(returned.entryPass.qrPayload);
    if (!returnedPassToken) throw new Error("The replacement entry payload could not be parsed.");

    const oldPassStillUnavailable = await checkInEntryPass(jsonRequest("/api/coordinator/check-in", {
      passToken: firstPassToken,
      eventId: selectedEventId
    }));
    expect(oldPassStillUnavailable.status).toBe(404);

    const replacementScan = await checkInEntryPass(jsonRequest("/api/coordinator/check-in", {
      passToken: returnedPassToken,
      eventId: selectedEventId
    }));
    expect(replacementScan.status).toBe(200);
    await expect(replacementScan.json()).resolves.toMatchObject({
      outcome: "checked_in",
      expectedAdults: 1,
      expectedChildren: 0,
      scanCount: 1
    });

    const pool = getDatabasePool();
    const persistedPasses = await pool.query<{ token_hash: string; status: string; pass_version: string }>(
      `select token_hash, status, pass_version
         from wedding.entry_passes
        where invitation_id = $1
        order by issued_at`,
      [issued.id]
    );
    expect(persistedPasses.rows).toHaveLength(2);
    expect(persistedPasses.rows.map((row) => row.status)).toEqual(["invalidated", "active"]);
    expect(JSON.stringify(persistedPasses.rows)).not.toContain(firstPassToken);
    expect(JSON.stringify(persistedPasses.rows)).not.toContain(returnedPassToken);

    const checkIns = await pool.query<{ event_id: string; scan_count: number }>(
      `select check_ins.event_id, check_ins.scan_count
         from wedding.entry_check_ins as check_ins
         join wedding.entry_passes as passes on passes.id = check_ins.entry_pass_id
        where passes.invitation_id = $1`,
      [issued.id]
    );
    expect(checkIns.rows).toHaveLength(2);
    expect(checkIns.rows.map((row) => row.event_id)).toEqual([selectedEventId, selectedEventId]);
    expect(checkIns.rows.map((row) => row.scan_count).sort()).toEqual([1, 2]);
  });

  it("reissues an active pass after a database QR pepper rotation instead of rendering an unscannable QR", async () => {
    resetRateLimitsForTest();
    const householdNameEn = `Key Change Test ${Date.now()}`;
    const issuedResponse = await issueInvitation(jsonRequest("/api/coordinator/invitations", {
      householdNameEn,
      householdNameHi: "",
      preferredLocale: "en",
      contactRole: "groom",
      eventLimits: [{ eventId: selectedEventId, adults: 2, children: 0 }]
    }));
    expect(issuedResponse.status).toBe(200);
    const { issued } = await issuedResponse.json() as { issued: { id: string; token: string } };
    const token = issued.token;
    if (!token) throw new Error("The database issuer did not return a token.");
    tokenHash = databaseInvitationTokenDigest(token);

    const attendingResponse = await submitRsvp(jsonRequest("/api/rsvp", {
      token,
      respondentName: "Key Change Guest",
      status: "attending",
      attendances: [{ eventId: selectedEventId, attending: true, adults: 2, children: 0 }]
    }));
    expect(attendingResponse.status).toBe(200);
    const attending = await attendingResponse.json() as { entryPass: { qrPayload: string } | null };
    const originalPayload = attending.entryPass?.qrPayload;
    if (!originalPayload) throw new Error("The attending RSVP did not receive an entry pass.");
    const originalToken = parseEntryPassPayload(originalPayload);
    if (!originalToken) throw new Error("The original QR payload was invalid.");

    // Rotating the dedicated QR pepper must rotate the pass too, rather than
    // returning a newly derived QR against an old digest.
    vi.stubEnv("DATABASE_ENTRY_PASS_TOKEN_PEPPER", `rotated-entry-pass-key-${Date.now()}`);
    const reloaded = await resolveInvitation(token);
    const replacementPayload = reloaded?.entryPass?.qrPayload;
    expect(replacementPayload).toMatch(/^shaadi-entry:v1:[A-Za-z0-9_-]{43}$/);
    expect(replacementPayload).not.toBe(originalPayload);
    if (!replacementPayload) throw new Error("The rotated QR payload was missing.");
    const replacementToken = parseEntryPassPayload(replacementPayload);
    if (!replacementToken) throw new Error("The replacement QR payload was invalid.");

    const staleScan = await checkInEntryPass(jsonRequest("/api/coordinator/check-in", {
      passToken: originalToken,
      eventId: selectedEventId
    }));
    expect(staleScan.status).toBe(404);

    const replacementScan = await checkInEntryPass(jsonRequest("/api/coordinator/check-in", {
      passToken: replacementToken,
      eventId: selectedEventId
    }));
    expect(replacementScan.status).toBe(200);
    await expect(replacementScan.json()).resolves.toMatchObject({
      outcome: "checked_in",
      householdName: householdNameEn,
      expectedAdults: 2,
      expectedChildren: 0
    });

    const persisted = await getDatabasePool().query<{
      token_hash: string;
      status: "active" | "invalidated";
      invalidation_reason: string | null;
    }>(
      `select token_hash, status, invalidation_reason
         from wedding.entry_passes
        where invitation_id = $1`,
      [issued.id]
    );
    expect(persisted.rows).toHaveLength(2);
    expect(persisted.rows.find((row) => row.status === "invalidated")).toMatchObject({
      invalidation_reason: "entry_pass_key_changed"
    });
    expect(persisted.rows.find((row) => row.status === "active")?.token_hash)
      .toBe(databaseEntryPassTokenDigest(replacementToken));
    expect(JSON.stringify(persisted.rows)).not.toContain(originalToken);
    expect(JSON.stringify(persisted.rows)).not.toContain(replacementToken);
  });
});
