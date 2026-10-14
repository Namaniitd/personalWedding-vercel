import { databaseUrlConfiguration } from "./database-configuration.js";

/** A production-image escape hatch confined to the documented Podman stack. */
export function isLocalStackPublicOrigin() {
  return process.env.NODE_ENV === "production"
    && process.env.LOCAL_STACK_MODE === "1"
    && (process.env.PUBLIC_APP_ORIGIN === "http://127.0.0.1:3000"
      || process.env.PUBLIC_APP_ORIGIN === "http://127.0.0.1:3001"
      || process.env.PUBLIC_APP_ORIGIN === "http://127.0.0.1:3002");
}

export function isLocalStackDatabase() {
  if (!isLocalStackPublicOrigin()) return false;

  try {
    const { url } = databaseUrlConfiguration();
    return url.hostname === "db"
      && (url.port === "" || url.port === "5432")
      && !url.searchParams.has("ssl")
      && !url.searchParams.has("sslmode")
      && !process.env.PGSSLMODE;
  } catch {
    return false;
  }
}
