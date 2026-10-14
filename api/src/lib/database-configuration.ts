const MAX_DATABASE_URL_LENGTH = 4_096;

export type DatabaseUrlConfiguration = {
  connectionString: string;
  url: URL;
};

/**
 * Parse only the application-owned connection URL. `pg` also accepts query
 * parameters that can replace the visible destination, so those are rejected
 * instead of allowing an operator typo to silently redirect this service.
 */
export function databaseUrlConfiguration(): DatabaseUrlConfiguration {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  if (connectionString.length > MAX_DATABASE_URL_LENGTH) {
    throw new Error("DATABASE_URL is too long.");
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
  }
  if (!url.hostname || !url.username || !url.password || url.pathname === "/") {
    throw new Error("DATABASE_URL must include a host, credentials, and database name.");
  }

  // node-postgres accepts these as connection overrides. Keep the configured
  // hostname, port, and credential identity unambiguous.
  for (const name of ["host", "hostaddr", "port", "user", "password"]) {
    if (url.searchParams.has(name)) {
      throw new Error(`DATABASE_URL must not include a ${name} query override.`);
    }
  }

  return { connectionString, url };
}

/**
 * Production must pin node-postgres to explicit full certificate and hostname
 * verification. Accepting `require` or a generic `ssl=true` leaves too much
 * parser-dependent downgrade ambiguity for bearer-link guest data.
 */
export function databaseUrlRequestsVerifiedTls(url: URL) {
  const sslModes = url.searchParams.getAll("sslmode");
  const sslValues = url.searchParams.getAll("ssl");
  if (
    url.searchParams.has("uselibpqcompat")
    || sslModes.length > 1
    || sslValues.length > 1
    || (sslModes.length === 1 && sslValues.length === 1)
  ) return false;
  return sslModes.length === 1 && sslModes[0] === "verify-full";
}

export function databaseEnvironmentRequestsVerifiedTls() {
  try {
    // Node's global escape hatch disables certificate verification for every
    // TLS client. PGSSLMODE can also request a weaker node-postgres mode when
    // a direct caller constructs a pool outside the normal route flow. Treat
    // either as an invalid production database configuration.
    const postgresSslMode = process.env.PGSSLMODE;
    return process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0"
      && (!postgresSslMode || postgresSslMode === "verify-full")
      && databaseUrlRequestsVerifiedTls(databaseUrlConfiguration().url);
  } catch {
    return false;
  }
}
