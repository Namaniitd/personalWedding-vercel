import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { handleApiRequest } from "./app";
import { parseEntryPassPayload } from "./domain/entry-pass";
import { saveDatabaseCoordinatorRSVP } from "./lib/database-coordinator-rsvps";
import { checkInDatabaseEntryPass, issueDatabaseInvitation, listDatabaseCoordinatorInvitations, resolveDatabaseInvitation, revokeDatabaseInvitation } from "./lib/database-invitations";
import { databaseInvitationTokenDigest, DatabaseRsvpClosedError, getDatabasePool, resetDatabaseRsvpPoolForTest, saveDatabaseRSVP } from "./lib/database-rsvps";
import { loadDatabaseWeddingConfiguration } from "./lib/database-wedding-content";

function isLoopback(value: string | undefined) {
  if (!value) return false;
  const client = new Client({ connectionString: value }) as Client & { connectionParameters: { host: string; isDomainSocket: boolean } };
  return !client.connectionParameters.isDomainSocket && ["127.0.0.1", "::1"].includes(client.connectionParameters.host);
}

const enabled = process.env.RUN_DATABASE_RUNTIME_TESTS === "true"
  && isLoopback(process.env.API_TEST_DATABASE_OWNER_URL) && isLoopback(process.env.DATABASE_URL);

(enabled ? describe : describe.skip)("coordinator RSVP under the restricted PostgreSQL runtime role", () => {
  let owner: Client;
  let eventId: string;
  let originalCutoff: Date;
  const ids: string[] = [];

  beforeAll(async () => {
    owner = new Client({ connectionString: process.env.API_TEST_DATABASE_OWNER_URL });
    await owner.connect();
    const configuration = await loadDatabaseWeddingConfiguration();
    eventId = configuration.events[0].event.id;
    const { rows } = await owner.query("select can_edit_until from wedding.settings where id=1");
    originalCutoff = rows[0].can_edit_until;
    const { rows: roles } = await getDatabasePool().query("select current_user, (select pg_get_userbyid(nspowner) from pg_namespace where nspname='wedding') as owner");
    expect(roles[0].current_user).not.toBe(roles[0].owner);
  });

  beforeEach(() => {
    vi.stubEnv("BACKEND_SERVICE_TOKEN", "runtime-integration-service-token-abcdefghijklmnopqrstuvwxyz");
    for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "INVITATION_TOKEN_PEPPER", "ENTRY_PASS_TOKEN_PEPPER"]) vi.stubEnv(key, "");
  });

  afterEach(async () => {
    await owner.query("update wedding.settings set can_edit_until=$1 where id=1", [originalCutoff]);
    const currentIds = ids.splice(0);
    await owner.query("update wedding.invitations set status='revoked', revoked_at=coalesce(revoked_at,now()) where id=any($1::uuid[])", [currentIds]);
    await owner.query("delete from wedding.rsvps where token_hash in (select token_hash from wedding.invitations where id=any($1::uuid[]))", [currentIds]);
    await owner.query("delete from wedding.entry_check_ins where entry_pass_id in (select id from wedding.entry_passes where invitation_id=any($1::uuid[]))", [currentIds]);
    await owner.query("delete from wedding.entry_passes where invitation_id=any($1::uuid[])", [currentIds]);
    await owner.query("delete from wedding.coordinator_rsvp_audit where invitation_id=any($1::uuid[])", [currentIds]);
    await owner.query("delete from wedding.invitations where id=any($1::uuid[])", [currentIds]);
    vi.unstubAllEnvs();
  });

  afterAll(async () => { await resetDatabaseRsvpPoolForTest(); await owner.end(); });

  async function issue(contactNumber?: string) {
    const issued = await issueDatabaseInvitation({ contactNumber, householdNameEn: "Runtime test household", preferredLocale: "en", contactRole: "groom", eventLimits: [{ eventId, adults: 2, children: 1 }] });
    ids.push(issued.id);
    return issued;
  }

  function details(invitationId: string) {
    return { invitationId, respondentName: "Phone Guest", status: "attending" as const,
      attendances: [{ eventId, attending: true, adults: 2, children: 1 }], comfortNote: "Vegetarian and step-free access", expectedUpdatedAt: null };
  }

  it("rejects post-cutoff guest writes and forged markers, but records an audited coordinator response", async () => {
    const issued = await issue();
    const input = details(issued.id);
    await owner.query("update wedding.settings set can_edit_until=clock_timestamp()-interval '1 minute' where id=1");
    const { invitationId: _id, expectedUpdatedAt: _revision, ...guestDetails } = input;
    const guest = { ...guestDetails, token: issued.token };
    const response = await handleApiRequest(new Request("http://api.internal/v1/rsvp", { method: "POST", headers: { "Content-Type": "application/json", "X-Backend-Service-Token": process.env.BACKEND_SERVICE_TOKEN! }, body: JSON.stringify(guest) }));
    expect(response.status).toBe(422);
    await expect(saveDatabaseRSVP(guest)).rejects.toBeInstanceOf(DatabaseRsvpClosedError);
    const runtime = await getDatabasePool().connect();
    try {
      await runtime.query("begin");
      await runtime.query("select set_config('wedding.coordinator_rsvp_write',$1,true)", [databaseInvitationTokenDigest(issued.token)]);
      await expect(runtime.query("insert into wedding.rsvps(token_hash,respondent_name,status,attendances) values($1,'Forged Guest','attending',$2::jsonb)", [databaseInvitationTokenDigest(issued.token), JSON.stringify(input.attendances)])).rejects.toMatchObject({ code: "23514", message: "Online RSVP is closed." });
      await runtime.query("rollback");
    } finally { runtime.release(); }
    const saved = await saveDatabaseCoordinatorRSVP(input);
    expect(saved.kind).toBe("saved");
    if (saved.kind !== "saved") throw new Error("Correction did not save");
    const list = await listDatabaseCoordinatorInvitations();
    expect(list.find((row) => row.id === issued.id)).toMatchObject({ eventLimits: [{ eventId, adults: 2, children: 1 }], rsvp: { respondentName: input.respondentName, comfortNote: input.comfortNote, updatedAt: saved.updatedAt } });
    expect(JSON.stringify(list)).not.toContain(issued.token);
    const { rows: audit } = await owner.query("select * from wedding.coordinator_rsvp_audit where invitation_id=$1", [issued.id]);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(input.comfortNote);
    await expect(getDatabasePool().query("insert into wedding.coordinator_rsvp_audit(invitation_id,updated_at) values($1,now())", [issued.id])).rejects.toMatchObject({ code: "42501" });
    await expect(getDatabasePool().query("alter function wedding.save_coordinator_rsvp(uuid,jsonb,timestamptz) security invoker")).rejects.toMatchObject({ code: "42501" });
  });

  it("inherits, edits and clears contact numbers without old clients erasing them", async () => {
    const issued = await issue("+91 (98765) 43210");
    expect((await resolveDatabaseInvitation(issued.token))?.invitation.contactNumber).toBe("+91 (98765) 43210");
    const input = details(issued.id);
    const { invitationId: _id, expectedUpdatedAt: _revision, ...payload } = input;
    const inherited = await saveDatabaseRSVP({ ...payload, token: issued.token });
    expect(inherited.record.contactNumber).toBe("+91 (98765) 43210");
    const edited = await saveDatabaseRSVP({ ...payload, token: issued.token, contactNumber: "+1 (202) 555-0123" });
    expect(edited.record.contactNumber).toBe("+1 (202) 555-0123");
    const preserved = await saveDatabaseRSVP({ ...payload, token: issued.token });
    expect(preserved.record.contactNumber).toBe("+1 (202) 555-0123");
    const manual = await saveDatabaseCoordinatorRSVP({ ...input, expectedUpdatedAt: preserved.record.updatedAt });
    if (manual.kind !== "saved") throw new Error("Manual RSVP did not save");
    expect((await resolveDatabaseInvitation(issued.token))?.rsvp?.contactNumber).toBe("+1 (202) 555-0123");
    const invalid = await getDatabasePool().query("select outcome from wedding.save_coordinator_rsvp($1,$2::jsonb,$3::timestamptz)", [issued.id, JSON.stringify({ ...payload, contactNumber: "not-a-phone" }), manual.updatedAt]);
    expect(invalid.rows[0].outcome).toBe("invalid");
    const cleared = await saveDatabaseCoordinatorRSVP({ ...input, contactNumber: "", expectedUpdatedAt: manual.updatedAt });
    expect(cleared.kind).toBe("saved");
    const final = await resolveDatabaseInvitation(issued.token);
    expect(final?.rsvp?.contactNumber).toBeUndefined();
    expect(final?.invitation.contactNumber).toBe("+91 (98765) 43210");
    const listed = (await listDatabaseCoordinatorInvitations()).find((row) => row.id === issued.id);
    expect(listed?.contactNumber).toBe("+91 (98765) 43210");
    expect(listed?.rsvp?.contactNumber).toBeUndefined();
    await expect(getDatabasePool().query("update wedding.rsvps set contact_number='invalid' where token_hash=$1", [databaseInvitationTokenDigest(issued.token)])).rejects.toMatchObject({ code: "23514" });
  });

  it("enforces revisions, invitation limits, revocation and pass invalidation/recovery", async () => {
    const issued = await issue();
    const input = details(issued.id);
    expect(await saveDatabaseCoordinatorRSVP({ ...input, attendances: [{ eventId, attending: true, adults: 3, children: 0 }] })).toEqual({ kind: "invalid" });
    expect(await saveDatabaseCoordinatorRSVP({ ...input, attendances: [] })).toEqual({ kind: "invalid" });
    expect(await saveDatabaseCoordinatorRSVP({ ...input, attendances: [{ eventId: "not-invited", attending: true, adults: 1, children: 0 }] })).toEqual({ kind: "invalid" });
    const saved = await saveDatabaseCoordinatorRSVP(input);
    if (saved.kind !== "saved") throw new Error("Initial RSVP did not save");
    expect(await saveDatabaseCoordinatorRSVP(input)).toEqual({ kind: "stale" });
    const resolved = await resolveDatabaseInvitation(issued.token);
    const oldPass = parseEntryPassPayload(resolved!.entryPass!.qrPayload)!;
    const corrections = await Promise.all(["First coordinator", "Second coordinator"].map((respondentName) => saveDatabaseCoordinatorRSVP({ ...input, respondentName, attendances: [{ eventId, attending: true, adults: 1, children: 0 }], expectedUpdatedAt: saved.updatedAt })));
    expect(corrections.filter((result) => result.kind === "saved")).toHaveLength(1);
    expect(corrections.filter((result) => result.kind === "stale")).toHaveLength(1);
    const corrected = corrections.find((result) => result.kind === "saved")!;
    if (corrected.kind !== "saved") throw new Error("Correction did not save");
    expect((await resolveDatabaseInvitation(issued.token))!.entryPass!.qrPayload).toBe(resolved!.entryPass!.qrPayload);
    expect(await checkInDatabaseEntryPass({ passToken: oldPass, eventId })).toMatchObject({ kind: "checked_in", expectedAdults: 1, expectedChildren: 0 });
    const declined = await saveDatabaseCoordinatorRSVP({ ...input, status: "declined", comfortNote: undefined, declineMessage: "Best wishes", attendances: [{ eventId, attending: false, adults: 0, children: 0 }], expectedUpdatedAt: corrected.updatedAt });
    if (declined.kind !== "saved") throw new Error("Decline did not save");
    expect(declined.updatedAt).not.toBe(saved.updatedAt);
    expect((await checkInDatabaseEntryPass({ passToken: oldPass, eventId })).kind).toBe("not_found");
    expect(await saveDatabaseCoordinatorRSVP({ ...input, expectedUpdatedAt: saved.updatedAt })).toEqual({ kind: "stale" });
    const restored = await saveDatabaseCoordinatorRSVP({ ...input, expectedUpdatedAt: declined.updatedAt });
    expect(restored.kind).toBe("saved");
    const newPass = parseEntryPassPayload((await resolveDatabaseInvitation(issued.token))!.entryPass!.qrPayload)!;
    expect(newPass).not.toBe(oldPass);
    expect((await checkInDatabaseEntryPass({ passToken: newPass, eventId })).kind).toBe("checked_in");
    await revokeDatabaseInvitation(issued.id);
    expect(await saveDatabaseCoordinatorRSVP({ ...input, expectedUpdatedAt: restored.kind === "saved" ? restored.updatedAt : null })).toEqual({ kind: "not_found" });
    expect((await checkInDatabaseEntryPass({ passToken: newPass, eventId })).kind).toBe("not_found");
  });

  it("returns every invitation beyond the former 500-row cap", async () => {
    const { rows } = await owner.query("insert into wedding.invitations(id,token_hash,household_name_en,household_name_hi,event_limits,preferred_locale,contact_role,access_expires_at) select gen_random_uuid(), md5('list-test-'||n)||md5('list-test-extra-'||n), 'List test household', 'List test household', $1::jsonb, 'en', 'groom', now()+interval '120 days' from generate_series(1,501) as n returning id", [JSON.stringify({ [eventId]: { adults: 2, children: 0 } })]);
    ids.push(...rows.map((row) => row.id));
    const listed = await listDatabaseCoordinatorInvitations();
    expect(listed.filter((row) => rows.some((inserted) => inserted.id === row.id))).toHaveLength(501);
  });

  it("keeps revisions distinct within one transaction and detects a later guest edit", async () => {
    const issued = await issue();
    const input = details(issued.id);
    const { invitationId: _id, expectedUpdatedAt: _revision, ...payload } = input;
    const client = await getDatabasePool().connect();
    let firstRevision: string;
    let correctedRevision: string;
    try {
      await client.query("begin");
      const first = await client.query("select outcome,updated_at from wedding.save_coordinator_rsvp($1,$2::jsonb,null)", [issued.id, JSON.stringify(payload)]);
      expect(first.rows[0].outcome).toBe("saved");
      firstRevision = new Date(first.rows[0].updated_at).toISOString();
      const second = await client.query("select outcome,updated_at from wedding.save_coordinator_rsvp($1,$2::jsonb,$3::timestamptz)", [issued.id, JSON.stringify({ ...payload, respondentName: "Corrected Guest" }), firstRevision]);
      expect(second.rows[0].outcome).toBe("saved");
      correctedRevision = new Date(second.rows[0].updated_at).toISOString();
      expect(correctedRevision).not.toBe(firstRevision);
      const third = await client.query("select outcome from wedding.save_coordinator_rsvp($1,$2::jsonb,$3::timestamptz)", [issued.id, JSON.stringify(payload), firstRevision]);
      expect(third.rows[0].outcome).toBe("stale");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally { client.release(); }
    const guest = await saveDatabaseRSVP({ ...payload, token: issued.token, respondentName: "Guest update" });
    expect(guest.record.updatedAt).not.toBe(correctedRevision!);
    expect(await saveDatabaseCoordinatorRSVP({ ...input, expectedUpdatedAt: correctedRevision! })).toEqual({ kind: "stale" });
  });
});
