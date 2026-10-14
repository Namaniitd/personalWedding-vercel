import { createHash, randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { takeDatabaseRateLimit } from "./lib/database-rate-limit";
import { getDatabasePool, resetDatabaseRsvpPoolForTest } from "./lib/database-rsvps";

function isLoopback(value: string | undefined) {
  if (!value) return false;
  const client = new Client({ connectionString: value }) as Client & { connectionParameters: { host: string; isDomainSocket: boolean } };
  return !client.connectionParameters.isDomainSocket && ["127.0.0.1", "::1"].includes(client.connectionParameters.host);
}

const enabled = process.env.RUN_RATE_LIMIT_DATABASE_TESTS === "true"
  && isLoopback(process.env.API_TEST_DATABASE_OWNER_URL) && isLoopback(process.env.DATABASE_URL);

(enabled ? describe : describe.skip)("atomic PostgreSQL rate limiting under the restricted runtime role", () => {
  let owner: Client;
  const hashes: string[] = [];
  function hash() {
    const value = createHash("sha256").update(randomUUID()).digest("hex");
    hashes.push(value);
    return value;
  }

  beforeAll(async () => {
    owner = new Client({ connectionString: process.env.API_TEST_DATABASE_OWNER_URL });
    await owner.connect();
  });
  afterAll(async () => {
    await owner.query("delete from wedding.rate_limit_buckets where key_hash = any($1::text[])", [hashes]);
    await resetDatabaseRsvpPoolForTest();
    await owner.end();
  });

  it("allows exactly eight of 32 concurrent requests and resets only after expiry", async () => {
    const keyHash = hash();
    const input = { keyHash, maxRequests: 8, windowMs: 60_000 };
    const results = await Promise.all(Array.from({ length: 32 }, () => takeDatabaseRateLimit(input)));
    expect(results.filter((result) => result.allowed)).toHaveLength(8);
    expect(results.filter((result) => !result.allowed).every((result) => result.retryAfterSeconds > 0)).toBe(true);
    const { rows } = await owner.query("select request_count from wedding.rate_limit_buckets where key_hash=$1", [keyHash]);
    expect(rows[0].request_count).toBe(9);
    await owner.query("update wedding.rate_limit_buckets set expires_at=clock_timestamp()-interval '1 second' where key_hash=$1", [keyHash]);
    expect(await takeDatabaseRateLimit(input)).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("consumes a coordinator OTP counter once across concurrent functions", async () => {
    const input = { keyHash: hash(), maxRequests: 1, windowMs: 120_000 };
    const results = await Promise.all(Array.from({ length: 12 }, () => takeDatabaseRateLimit(input)));
    expect(results.filter((result) => result.allowed)).toHaveLength(1);
  });

  it("grants execution without direct counter access or PUBLIC execution", async () => {
    const { rows } = await getDatabasePool().query("select current_user, has_table_privilege(current_user,'wedding.rate_limit_buckets','SELECT') as readable, has_table_privilege(current_user,'wedding.rate_limit_buckets','UPDATE') as writable, has_function_privilege(current_user,'wedding.take_rate_limit(text,integer,integer)','EXECUTE') as executable");
    expect(rows[0]).toMatchObject({ readable: false, writable: false, executable: true });
    await expect(getDatabasePool().query("select * from wedding.rate_limit_buckets")).rejects.toMatchObject({ code: "42501" });
    const { rows: grants } = await owner.query("select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='wedding.take_rate_limit(text,integer,integer)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'");
    expect(grants).toHaveLength(0);
  });

  it("cleans at most 100 expired rows per call and eventually clears older buckets", async () => {
    const expiredHashes = Array.from({ length: 205 }, () => hash());
    await owner.query("insert into wedding.rate_limit_buckets(key_hash,request_count,expires_at) select key_hash,1,'1970-01-01'::timestamptz from unnest($1::text[]) as key_hash", [expiredHashes]);
    const input = { keyHash: hash(), maxRequests: 8, windowMs: 60_000 };
    expect((await takeDatabaseRateLimit(input)).allowed).toBe(true);
    const { rows } = await owner.query("select count(*)::integer as remaining from wedding.rate_limit_buckets where key_hash=any($1::text[])", [expiredHashes]);
    expect(rows[0].remaining).toBe(105);
    await takeDatabaseRateLimit(input);
    await takeDatabaseRateLimit(input);
    const { rows: cleared } = await owner.query("select count(*)::integer as remaining from wedding.rate_limit_buckets where key_hash=any($1::text[])", [expiredHashes]);
    expect(cleared[0].remaining).toBe(0);
  });
});
