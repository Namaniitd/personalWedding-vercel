import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

function isDisposableLoopback(value: string | undefined) {
  if (!value) return false;
  const probe = new Client({ connectionString: value }) as Client & { connectionParameters: { host: string; port: number; isDomainSocket: boolean } };
  return !probe.connectionParameters.isDomainSocket && ["127.0.0.1", "::1"].includes(probe.connectionParameters.host)
    && Number(probe.connectionParameters.port) === 54329;
}

const enabled = process.env.RUN_SIDE_SCHEMA_DATABASE_TESTS === "true"
  && isDisposableLoopback(process.env.API_TEST_DATABASE_OWNER_URL) && isDisposableLoopback(process.env.DATABASE_URL);
const digest = () => createHash("sha256").update(randomUUID()).digest("hex");

(enabled ? describe : describe.skip)("side isolation schema on the disposable synthetic database", () => {
  let owner: Client;
  let runtimeRole: string;
  let schema: string;

  beforeAll(async () => {
    owner = new Client({ connectionString: process.env.API_TEST_DATABASE_OWNER_URL });
    await owner.connect();
    expect((await owner.query("select title_en from wedding.events where id='test-event' and side='groom'")).rows[0]?.title_en).toBe("Test event");
    runtimeRole = decodeURIComponent(new URL(process.env.DATABASE_URL!).username);
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) throw new Error("A simple synthetic runtime role name is required.");
    expect((await owner.query("select current_user")).rows[0].current_user).not.toBe(runtimeRole);
    schema = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8");
  });

  beforeEach(async () => {
    await owner.query("begin");
    await owner.query(`insert into wedding.settings
      select (jsonb_populate_record(null::wedding.settings, to_jsonb(settings) || '{"id":2,"side":"bride"}'::jsonb)).*
      from wedding.settings as settings where id=1`);
    await owner.query(`insert into wedding.events
      select (jsonb_populate_record(null::wedding.events, to_jsonb(events) || '{"id":"test-bride-event","side":"bride"}'::jsonb)).*
      from wedding.events as events where id='test-event'`);
    await owner.query("insert into wedding.contacts(side,role,name,phone) values('groom','groom','Test groom contact','9876543210'),('bride','groom','Test bride contact','9876543211')");
  });

  afterEach(async () => { await owner.query("rollback"); });
  afterAll(async () => { await owner.end(); });

  async function issue(side: "groom" | "bride", eventId = side === "bride" ? "test-bride-event" : "test-event") {
    const id = randomUUID(), tokenHash = digest();
    await owner.query(`insert into wedding.invitations(id,side,token_hash,household_name_en,household_name_hi,preferred_locale,contact_role,event_limits,access_expires_at)
      values($1,$2,$3,'Synthetic household','परीक्षण परिवार','en','bride',$4::jsonb,now()+interval '90 days')`,
    [id, side, tokenHash, JSON.stringify({ [eventId]: { adults: 2, children: 0 } })]);
    return { id, tokenHash, eventId };
  }

  async function attempt(sql: string, parameters: unknown[] = []) {
    await owner.query("savepoint expected_failure");
    try {
      await owner.query(sql, parameters);
      return null;
    } catch (error) {
      await owner.query("rollback to savepoint expected_failure");
      return error;
    } finally {
      await owner.query("release savepoint expected_failure");
    }
  }

  function response(eventId: string) {
    return { respondentName: "Synthetic Guest", status: "attending", attendances: [{ eventId, attending: true, adults: 1, children: 0 }] };
  }

  it("upgrades legacy rows as groom data, preserves existing links, and can apply the migration twice", async () => {
    const invitation = await issue("groom");
    const sessionHash = digest();
    await owner.query("insert into wedding.coordinator_sessions(session_hash,expires_at) values($1,now()+interval '1 hour')", [sessionHash]);
    await owner.query("delete from wedding.contacts where side='bride'");
    await owner.query("delete from wedding.events where side='bride'");
    await owner.query("delete from wedding.settings where side='bride'");
    await owner.query(`alter table wedding.settings drop column side cascade;
      alter table wedding.settings add constraint wedding_settings_id_check check(id=1);
      alter table wedding.contacts drop column side cascade;
      alter table wedding.contacts add constraint wedding_contacts_pkey primary key(role);
      alter table wedding.events drop column side cascade;
      alter table wedding.events add constraint events_slug_key unique(slug);
      alter table wedding.events drop column description_en, drop column description_hi, drop column popup_details;
      alter table wedding.invitations drop column side cascade;
      alter table wedding.coordinator_sessions drop column side cascade`);
    await owner.query(schema);
    await owner.query(schema);
    expect((await owner.query("select side,contact_role,token_hash from wedding.invitations where id=$1", [invitation.id])).rows[0])
      .toEqual({ side: "groom", contact_role: "bride", token_hash: invitation.tokenHash });
    expect((await owner.query("select side,description_en,description_hi,popup_details from wedding.events where id='test-event'")).rows[0])
      .toEqual({ side: "groom", description_en: "", description_hi: "", popup_details: [] });
    expect((await owner.query("select side from wedding.coordinator_sessions where session_hash=$1", [sessionHash])).rows[0]?.side).toBe("groom");
  });

  it("allows the same slug and contact role on separate sides but rejects invalid ownership and popup data", async () => {
    expect((await owner.query("select side from wedding.events where slug='test-event' order by side")).rows).toEqual([{ side: "bride" }, { side: "groom" }]);
    expect((await owner.query("select side from wedding.contacts where role='groom' order by side")).rows).toEqual([{ side: "bride" }, { side: "groom" }]);
    expect(await attempt("update wedding.settings set side='groom' where id=2")).toMatchObject({ code: "23514" });
    expect(await attempt("update wedding.events set side='bride' where id='test-event'")).toMatchObject({ code: "23514" });
    expect(await attempt("update wedding.events set popup_details='{}'::jsonb where id='test-event'")).toBeTruthy();
    expect(await attempt("update wedding.events set description_en=$1 where id='test-event'", ["a".repeat(2_401)])).toMatchObject({ code: "23514" });
    const groom = await issue("groom");
    expect(await attempt("update wedding.invitations set side='bride' where id=$1", [groom.id])).toMatchObject({ code: "23514" });
    expect(await attempt("update wedding.invitations set event_limits=$1::jsonb where id=$2", [JSON.stringify({ "test-bride-event": { adults: 1, children: 0 } }), groom.id])).toMatchObject({ code: "23514" });
  });

  it("uses the invitation side's RSVP cutoff and prevents guest writes from forging the coordinator bypass", async () => {
    const groom = await issue("groom"), bride = await issue("bride");
    await owner.query("update wedding.settings set can_edit_until=clock_timestamp()-interval '1 minute' where id=1");
    await owner.query(`set local role "${runtimeRole}"`);
    await owner.query("insert into wedding.rsvps(token_hash,respondent_name,status,attendances) values($1,'Synthetic Guest','attending',$2::jsonb)", [bride.tokenHash, JSON.stringify(response(bride.eventId).attendances)]);
    await owner.query("select set_config('wedding.coordinator_rsvp_write',$1,true)", [groom.tokenHash]);
    expect(await attempt("insert into wedding.rsvps(token_hash,respondent_name,status,attendances) values($1,'Synthetic Guest','attending',$2::jsonb)", [groom.tokenHash, JSON.stringify(response(groom.eventId).attendances)])).toMatchObject({ code: "23514", message: "Online RSVP is closed." });
    expect((await owner.query("select * from wedding.save_coordinator_rsvp($1,$2::jsonb,null::timestamptz,'bride')", [groom.id, JSON.stringify(response(groom.eventId))])).rows[0]?.outcome).toBe("not_found");
    expect((await owner.query("select * from wedding.save_coordinator_rsvp($1,$2::jsonb,null::timestamptz,'groom')", [groom.id, JSON.stringify(response(groom.eventId))])).rows[0]?.outcome).toBe("saved");
  });

  it("binds durable session registration, validation, revocation and compatibility calls to their side", async () => {
    const sessionHash = digest(), legacyHash = digest();
    await owner.query(`set local role "${runtimeRole}"`);
    const expires = new Date(Date.now() + 3_600_000).toISOString();
    expect((await owner.query("select wedding.coordinator_session('register',$1,$2::timestamptz,'bride') as ok", [sessionHash, expires])).rows[0].ok).toBe(true);
    expect((await owner.query("select wedding.coordinator_session('validate',$1,null::timestamptz,'groom') as ok", [sessionHash])).rows[0].ok).toBe(false);
    expect((await owner.query("select wedding.coordinator_session('validate',$1,null::timestamptz) as ok", [sessionHash])).rows[0].ok).toBe(false);
    await owner.query("select wedding.coordinator_session('revoke',$1,null::timestamptz,'groom')", [sessionHash]);
    expect((await owner.query("select wedding.coordinator_session('validate',$1,null::timestamptz,'bride') as ok", [sessionHash])).rows[0].ok).toBe(true);
    expect((await owner.query("select wedding.coordinator_session('register',$1,$2::timestamptz) as ok", [legacyHash, expires])).rows[0].ok).toBe(true);
    expect((await owner.query("select wedding.coordinator_session('validate',$1,null::timestamptz,'bride') as ok", [legacyHash])).rows[0].ok).toBe(false);
    expect(await attempt("select * from wedding.coordinator_sessions")).toMatchObject({ code: "42501" });
    expect(await attempt("update wedding.invitations set side='bride'")).toMatchObject({ code: "42501" });
    await owner.query("reset role");
    const { rows } = await owner.query(`select 1 from pg_proc p,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid in ('wedding.coordinator_session(text,text,timestamptz)'::regprocedure,
        'wedding.coordinator_session(text,text,timestamptz,text)'::regprocedure,
        'wedding.save_coordinator_rsvp(uuid,jsonb,timestamptz)'::regprocedure,
        'wedding.save_coordinator_rsvp(uuid,jsonb,timestamptz,text)'::regprocedure)
        and a.grantee=0 and a.privilege_type='EXECUTE'`);
    expect(rows).toHaveLength(0);
  });

  it("rejects a cross-side scanner admission even if a malformed RSVP claims that event", async () => {
    const groom = await issue("groom");
    await owner.query("insert into wedding.rsvps(token_hash,respondent_name,status,attendances) values($1,'Synthetic Guest','attending',$2::jsonb)", [groom.tokenHash, JSON.stringify(response("test-bride-event").attendances)]);
    const passId = randomUUID();
    await owner.query("insert into wedding.entry_passes(id,invitation_id,token_hash,pass_version) values($1,$2,$3,$4)", [passId, groom.id, digest(), randomUUID()]);
    expect(await attempt("insert into wedding.entry_check_ins(id,entry_pass_id,event_id,expected_adult_count,expected_child_count) values($1,$2,'test-bride-event',1,0)", [randomUUID(), passId])).toMatchObject({ code: "23514", message: "The event must belong to the invitation workspace." });
  });
});
