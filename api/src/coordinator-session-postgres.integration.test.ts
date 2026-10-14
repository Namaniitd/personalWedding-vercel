import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { manageDatabaseCoordinatorSession } from "./lib/database-coordinator-sessions";
import { getDatabasePool, resetDatabaseRsvpPoolForTest } from "./lib/database-rsvps";

function isDisposableLoopback(value: string | undefined) {
  if (!value) return false;
  const probe = new Client({ connectionString: value }) as Client & { connectionParameters: { host: string; port: number; isDomainSocket: boolean } };
  return !probe.connectionParameters.isDomainSocket && ["127.0.0.1", "::1"].includes(probe.connectionParameters.host)
    && Number(probe.connectionParameters.port) === 54329;
}
const enabled = process.env.RUN_COORDINATOR_SESSION_DATABASE_TESTS === "true"
  && isDisposableLoopback(process.env.API_TEST_DATABASE_OWNER_URL) && isDisposableLoopback(process.env.DATABASE_URL);

(enabled ? describe : describe.skip)("durable coordinator sessions under the restricted runtime role", () => {
  let owner: Client;
  const hashes: string[] = [];
  function hash() {
    const value = createHash("sha256").update(randomUUID()).digest("hex");
    hashes.push(value);
    return value;
  }
  function register(sessionHash: string) {
    return { action: "register" as const, sessionHash, expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
  }
  beforeAll(async () => {
    owner = new Client({ connectionString: process.env.API_TEST_DATABASE_OWNER_URL });
    await owner.connect();
    expect((await owner.query("select 1 from wedding.events where id = 'test-event'")).rows).toHaveLength(1);
  });
  afterAll(async () => {
    await owner.query("delete from wedding.coordinator_sessions where session_hash = any($1::text[])", [hashes]);
    await resetDatabaseRsvpPoolForTest();
    await owner.end();
  });

  it("requires registration and keeps a revoked session invalid across subsequent requests", async () => {
    const sessionHash = hash();
    const input = register(sessionHash);
    expect(await manageDatabaseCoordinatorSession({ action: "validate", sessionHash })).toBe(false);
    expect(await manageDatabaseCoordinatorSession(input)).toBe(true);
    expect(await manageDatabaseCoordinatorSession(input)).toBe(true);
    expect(await manageDatabaseCoordinatorSession({ action: "validate", sessionHash })).toBe(true);
    expect(await manageDatabaseCoordinatorSession({ action: "revoke", sessionHash })).toBe(true);
    const checks = await Promise.all(Array.from({ length: 12 }, () => manageDatabaseCoordinatorSession({ action: "validate", sessionHash })));
    expect(checks.every((ok) => !ok)).toBe(true);
    expect(await manageDatabaseCoordinatorSession(input)).toBe(false);
  });

  it("revokes only the selected session", async () => {
    const first = hash(), second = hash();
    await manageDatabaseCoordinatorSession(register(first));
    await manageDatabaseCoordinatorSession(register(second));
    await manageDatabaseCoordinatorSession({ action: "revoke", sessionHash: first });
    expect(await manageDatabaseCoordinatorSession({ action: "validate", sessionHash: second })).toBe(true);
  });

  it("rejects expired sessions and prevents extending a registered session", async () => {
    const sessionHash = hash();
    const input = register(sessionHash);
    await manageDatabaseCoordinatorSession(input);
    expect(await manageDatabaseCoordinatorSession({ ...input, expiresAt: new Date(Date.now() + 7_200_000).toISOString() })).toBe(false);
    await owner.query("update wedding.coordinator_sessions set created_at=clock_timestamp()-interval '2 hours', expires_at=clock_timestamp()-interval '1 second' where session_hash=$1", [sessionHash]);
    expect(await manageDatabaseCoordinatorSession({ action: "validate", sessionHash })).toBe(false);
    expect(await manageDatabaseCoordinatorSession({ ...register(hash()), expiresAt: new Date(Date.now() + 9 * 3_600_000).toISOString() })).toBe(false);
  });

  it("grants only the session function and denies direct reads or mutations", async () => {
    const { rows } = await getDatabasePool().query("select has_table_privilege(current_user,'wedding.coordinator_sessions','SELECT') as readable, has_table_privilege(current_user,'wedding.coordinator_sessions','UPDATE') as writable, has_function_privilege(current_user,'wedding.coordinator_session(text,text,timestamptz)','EXECUTE') as executable");
    expect(rows[0]).toMatchObject({ readable: false, writable: false, executable: true });
    await expect(getDatabasePool().query("select * from wedding.coordinator_sessions")).rejects.toMatchObject({ code: "42501" });
    await expect(getDatabasePool().query("update wedding.coordinator_sessions set revoked_at=null")).rejects.toMatchObject({ code: "42501" });
    const { rows: grants } = await owner.query("select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='wedding.coordinator_session(text,text,timestamptz)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'");
    expect(grants).toHaveLength(0);
  });
});
