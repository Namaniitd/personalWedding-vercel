// Applies local wedding content (database/content.local.sql) to the database
// named by DATABASE_URL. Content is data, not schema, so this deliberately
// stays separate from apply-database-schema.mjs.
//
// Run it with `pnpm content:apply`, which supplies .env.local via --env-file.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Client } from "pg";

const contentPath = process.env.CONTENT_SQL_FILE
  ? resolve(process.env.CONTENT_SQL_FILE)
  : fileURLToPath(new URL("../database/content.local.sql", import.meta.url));
const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  console.error("DATABASE_URL is required. Set it in api/.env.local.");
  process.exit(1);
}

let databaseUrl;
try {
  databaseUrl = new URL(connectionString);
} catch {
  console.error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  process.exit(1);
}

if (!new Set(["postgres:", "postgresql:"]).has(databaseUrl.protocol)) {
  console.error("DATABASE_URL must use the postgres or postgresql protocol.");
  process.exit(1);
}

// Real wedding details belong on a database the operator controls locally.
// Refuse anything that is not loopback so this never overwrites a deployment.
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
if (!loopbackHosts.has(databaseUrl.hostname)) {
  console.error(`Refusing to apply content to non-loopback host ${databaseUrl.hostname}.`);
  process.exit(1);
}

const sql = await readFile(contentPath, "utf8");
const client = new Client({ connectionString, connectionTimeoutMillis: 5_000 });

try {
  await client.connect();
  await client.query(sql);

  const { rows: [summary] } = await client.query(`
    select
      (select count(*) from wedding.events where published) as published_events,
      (select count(*) from wedding.contacts where is_active) as contacts
  `);
  console.log(`Applied content: ${summary.published_events} published events, ${summary.contacts} reply-to contacts.`);
} catch (error) {
  console.error("Applying wedding content failed.");
  if (error && typeof error === "object" && "code" in error) console.error(`Database error code: ${String(error.code)}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
