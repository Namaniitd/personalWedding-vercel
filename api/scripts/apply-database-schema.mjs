import { readFile } from "node:fs/promises";
import { Client } from "pg";

const schemaConnectionString = process.env.DATABASE_SCHEMA_URL?.trim();
const runtimeConnectionString = process.env.DATABASE_URL?.trim();
const connectionString = schemaConnectionString || runtimeConnectionString;
const connectionVariableName = schemaConnectionString ? "DATABASE_SCHEMA_URL" : "DATABASE_URL";
const applyTarget = process.env.DATABASE_SCHEMA_APPLY_TARGET?.trim();
const productionConfirmation = process.env.DATABASE_SCHEMA_APPLY_CONFIRMATION?.trim();

function hasExactlyOneQueryValue(url, name, expectedValue) {
  const values = url.searchParams.getAll(name);
  return values.length === 1 && values[0] === expectedValue;
}

if (!connectionString) {
  console.error("DATABASE_SCHEMA_URL or DATABASE_URL is required before applying the database schema.");
  process.exit(1);
}

if (applyTarget && applyTarget !== "production") {
  console.error("DATABASE_SCHEMA_APPLY_TARGET must be unset or exactly production.");
  process.exit(1);
}

let databaseUrl;
try {
  databaseUrl = new URL(connectionString);
} catch {
  console.error(`${connectionVariableName} must be a valid PostgreSQL connection URL.`);
  process.exit(1);
}

if (!new Set(["postgres:", "postgresql:"]).has(databaseUrl.protocol)) {
  console.error(`${connectionVariableName} must use the postgres or postgresql protocol.`);
  process.exit(1);
}

if (!databaseUrl.hostname || !databaseUrl.username || !databaseUrl.password || databaseUrl.pathname === "/") {
  console.error(`${connectionVariableName} must include a host, credentials, and database name.`);
  process.exit(1);
}

const forbiddenQueryOverrides = ["host", "hostaddr", "port", "user", "password"];
if (forbiddenQueryOverrides.some((name) => databaseUrl.searchParams.has(name))) {
  console.error(`${connectionVariableName} must put host, port, user, and password in its authority component, not query parameters.`);
  process.exit(1);
}

const sslModeValues = databaseUrl.searchParams.getAll("sslmode");
const sslValues = databaseUrl.searchParams.getAll("ssl");
if (sslModeValues.length > 1
  || sslValues.length > 1
  || (sslModeValues.length > 0 && sslValues.length > 0)
  || databaseUrl.searchParams.has("uselibpqcompat")) {
  console.error("DATABASE_URL has ambiguous or unsupported TLS query parameters.");
  process.exit(1);
}

const client = new Client({ connectionString, connectionTimeoutMillis: 5_000 });

// `pg` permits a `?host=` query parameter to override the hostname shown in a
// PostgreSQL URL. Use the parsed client configuration so this tool validates
// the actual destination rather than only the URL's authority component.
const effectiveHost = client.connectionParameters.host.replace(/^\[([^\]]+)\]$/, "$1");
const loopbackAddress = effectiveHost === "127.0.0.1" || effectiveHost === "::1";
if (client.connectionParameters.isDomainSocket) {
  console.error(`${connectionVariableName} must address a TCP PostgreSQL server, not a domain socket.`);
  process.exit(1);
}

const applyingToProduction = applyTarget === "production";
if (process.env.NODE_ENV === "production" && !applyingToProduction) {
  console.error("Production schema changes require DATABASE_SCHEMA_APPLY_TARGET=production.");
  process.exit(1);
}

if (!loopbackAddress && !applyingToProduction) {
  console.error("Non-loopback database schema changes require DATABASE_SCHEMA_APPLY_TARGET=production.");
  process.exit(1);
}

if (applyingToProduction && productionConfirmation !== "apply-production-schema") {
  console.error("Production schema changes require DATABASE_SCHEMA_APPLY_CONFIRMATION=apply-production-schema.");
  process.exit(1);
}

if (applyingToProduction && !schemaConnectionString) {
  console.error("Production schema changes require DATABASE_SCHEMA_URL, not the application DATABASE_URL.");
  process.exit(1);
}

if (effectiveHost === "0.0.0.0" || effectiveHost === "::") {
  console.error(`${connectionVariableName} must not use an unspecified database address.`);
  process.exit(1);
}

if (applyingToProduction) {
  // pg reads repeated query parameters with last-value-wins semantics, while
  // URLSearchParams#get returns the first value. Reject ambiguity rather than
  // validating one TLS setting and connecting with another.
  const effectiveSsl = client.connectionParameters.ssl;
  const tlsVerificationDisabled = typeof effectiveSsl === "object"
    && effectiveSsl !== null
    && effectiveSsl.rejectUnauthorized === false;

  if (!hasExactlyOneQueryValue(databaseUrl, "sslmode", "verify-full")
    || !effectiveSsl
    || tlsVerificationDisabled
    || process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
    || (process.env.PGSSLMODE && process.env.PGSSLMODE !== "verify-full")) {
    console.error("Production DATABASE_SCHEMA_URL must use one unambiguous sslmode=verify-full setting with certificate verification enabled.");
    process.exit(1);
  }
}

const schemaUrl = new URL("../database/schema.sql", import.meta.url);
const schema = await readFile(schemaUrl, "utf8");

try {
  await client.connect();
  await client.query("begin");
  await client.query(schema);
  await client.query("commit");
  console.log("Wedding database schema is up to date. No wedding data was added.");
} catch (error) {
  try {
    await client.query("rollback");
  } catch {
    // The original database error is more useful to the operator.
  }
  console.error(`Could not apply the database schema: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
