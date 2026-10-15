import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { Client } from "pg";

const ownerUrl = process.env.DATABASE_SCHEMA_URL?.trim();
const runtimeRole = process.env.DATABASE_RUNTIME_ROLE ?? "shaadi_app";
const runtimePassword = process.env.DATABASE_RUNTIME_PASSWORD;
if (!ownerUrl) throw new Error("Fill DATABASE_SCHEMA_URL in .deployment/neon-setup.env first.");
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) throw new Error("Invalid runtime role name.");
if (!runtimePassword || !/^[A-Za-z0-9_-]{32,256}$/.test(runtimePassword)) {
  throw new Error("Use a separate random, URL-safe runtime password of at least 32 characters.");
}
let parsedOwnerUrl;
try {
  parsedOwnerUrl = new URL(ownerUrl);
} catch {
  throw new Error("DATABASE_SCHEMA_URL is not a valid URL. Its value was omitted from this error.");
}
if (!parsedOwnerUrl.hostname.endsWith(".neon.tech") || parsedOwnerUrl.hostname.includes("-pooler.")) {
  throw new Error("Use the direct Neon owner connection URL, with pooling switched off.");
}
if (process.env.DATABASE_SCHEMA_APPLY_TARGET !== "production"
  || process.env.DATABASE_SCHEMA_APPLY_CONFIRMATION !== "apply-production-schema") {
  throw new Error("The operator environment must include the documented production schema confirmation.");
}

// The existing migration tool verifies the destination, TLS, and production
// acknowledgement before connecting. It never imports local wedding content.
try {
  const { stdout } = await promisify(execFile)(process.execPath,
    [fileURLToPath(new URL("./apply-database-schema.mjs", import.meta.url))],
    { env: { ...process.env, DATABASE_URL: "" } });
  process.stdout.write(stdout);
} catch {
  throw new Error("Schema setup failed. Check the direct owner URL, verified TLS, and the production confirmation values.");
}

const client = new Client({ connectionString: ownerUrl, connectionTimeoutMillis: 15_000 });
try {
  await client.connect();
  const { rows } = await client.query("select 1 from pg_roles where rolname = $1", [runtimeRole]);
  if (!rows.length) {
    // Both substitutions are restricted above; neither can contain SQL syntax.
    // Create through SQL, since roles made in Neon's dashboard inherit admin privileges.
    await client.query(`create role "${runtimeRole}" login password '${runtimePassword}' nosuperuser nocreatedb nocreaterole noreplication nobypassrls`);
  }
  // Some PostgreSQL installations permit every role to create in public.
  // This app's grant verifier rejects that inherited privilege.
  await client.query("revoke create on schema public from public");
  const databaseName = decodeURIComponent(parsedOwnerUrl.pathname.slice(1));
  await client.query(`revoke create on database "${databaseName.replaceAll('"', '""')}" from public`);
  await client.query(`grant connect on database "${databaseName.replaceAll('"', '""')}" to "${runtimeRole}"`);

  const template = await readFile(new URL("../database/grant-runtime-role.sql", import.meta.url), "utf8");
  const grants = template
    .replace(/^\\set[^\n]*\n/gm, "")
    .replaceAll(':"runtime_role"', `"${runtimeRole}"`)
    .replaceAll(":'runtime_role'", `'${runtimeRole}'`);
  await client.query(grants);

  const runtimeUrl = new URL(parsedOwnerUrl);
  runtimeUrl.username = runtimeRole;
  runtimeUrl.password = runtimePassword;
  runtimeUrl.hostname = runtimeUrl.hostname.replace(/\./, "-pooler.");
  const runtimeClient = new Client({ connectionString: runtimeUrl.toString(), connectionTimeoutMillis: 15_000 });
  try {
    await runtimeClient.connect();
    await runtimeClient.query("select id, side from wedding.settings limit 1");
    const { rows: permissionChecks } = await runtimeClient.query(`select
      has_column_privilege(current_user, 'wedding.invitations', 'side', 'SELECT')
        and has_column_privilege(current_user, 'wedding.invitations', 'side', 'INSERT')
        and not has_column_privilege(current_user, 'wedding.invitations', 'side', 'UPDATE')
        and has_function_privilege(current_user, 'wedding.save_coordinator_rsvp(uuid,jsonb,timestamptz,text)', 'EXECUTE')
        and has_function_privilege(current_user, 'wedding.coordinator_session(text,text,timestamptz,text)', 'EXECUTE')
        and not has_table_privilege(current_user, 'wedding.coordinator_sessions', 'SELECT') as ok`);
    if (permissionChecks[0]?.ok !== true) throw new Error("The side-scoped runtime grants are incomplete.");
  } finally {
    await runtimeClient.end();
  }

  const envFile = new URL("../../.deployment/api.env", import.meta.url);
  const environment = await readFile(envFile, "utf8");
  if (!/^DATABASE_URL=.*$/m.test(environment)) throw new Error("The generated API environment file is missing DATABASE_URL.");
  await writeFile(envFile, environment.replace(/^DATABASE_URL=.*$/m, () => `DATABASE_URL=${runtimeUrl}`), { mode: 0o600 });
  process.stdout.write("Neon schema and restricted runtime grants applied. Saved the pooled runtime URL in .deployment/api.env.\n");
  process.stdout.write("No wedding content or invitations were created. The owner connection URL stays operator-only.\n");
} catch {
  // Never print a connection URL, password, SQL body, or a nested pg error.
  throw new Error("Neon runtime setup failed. Check the owner permissions and existing role password; use a new runtime role name if an unrelated role already exists.");
} finally {
  await client.end().catch(() => undefined);
}
