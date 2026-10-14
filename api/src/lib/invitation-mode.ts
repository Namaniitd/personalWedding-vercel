import { databaseEnvironmentRequestsVerifiedTls } from "./database-configuration.js";
import { hasConfiguredHostedSupabaseUrl } from "./hosted-configuration.js";
import { isLocalStackDatabase } from "./local-stack.js";
import { hasConfiguredCanonicalPublicOrigin } from "./public-origin.js";

const HOSTED_ENVIRONMENT_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "INVITATION_TOKEN_PEPPER", "ENTRY_PASS_TOKEN_PEPPER"] as const;
const DATABASE_ENVIRONMENT_KEYS = [
  "DATABASE_URL",
  "DATABASE_INVITATION_TOKEN_PEPPER",
  "DATABASE_ENTRY_PASS_TOKEN_PEPPER"
] as const;

export type InvitationStoreMode = "hosted" | "database" | "disabled";

function environmentValueExists(key: string) {
  return Boolean(process.env[key]?.trim());
}

function configuredEnvironmentCount(keys: readonly string[]) {
  return keys.filter(environmentValueExists).length;
}

function requiresProductionDatabaseProtections() {
  return process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test";
}

export function getInvitationStoreMode(): InvitationStoreMode {
  const hostedConfiguredCount = configuredEnvironmentCount(HOSTED_ENVIRONMENT_KEYS);
  const databaseConfiguredCount = configuredEnvironmentCount(DATABASE_ENVIRONMENT_KEYS);

  // Partial credentials and ambiguous dual backends are deployment mistakes.
  // Fail closed rather than risking reads or writes against the wrong wedding.
  if (hostedConfiguredCount > 0 && hostedConfiguredCount !== HOSTED_ENVIRONMENT_KEYS.length) return "disabled";
  if (databaseConfiguredCount > 0 && databaseConfiguredCount !== DATABASE_ENVIRONMENT_KEYS.length) return "disabled";
  if (hostedConfiguredCount === HOSTED_ENVIRONMENT_KEYS.length && databaseConfiguredCount === DATABASE_ENVIRONMENT_KEYS.length) {
    return "disabled";
  }
  if (hostedConfiguredCount === HOSTED_ENVIRONMENT_KEYS.length) {
    return hasConfiguredHostedSupabaseUrl() ? "hosted" : "disabled";
  }

  if (databaseConfiguredCount === DATABASE_ENVIRONMENT_KEYS.length) {
    // A direct database can serve guest invitation pages in a deployment, but
    // only after both its public origin and encrypted database transport are
    // explicitly configured. Development and test retain loopback validation
    // in the pool module, where node-postgres resolves the effective host.
    if (requiresProductionDatabaseProtections()
      && !isLocalStackDatabase()
      && (!hasConfiguredCanonicalPublicOrigin() || !databaseEnvironmentRequestsVerifiedTls())) {
      return "disabled";
    }
    return "database";
  }
  return "disabled";
}

export function isHostedStoreConfigured() {
  return getInvitationStoreMode() === "hosted";
}

export function isDatabaseStoreConfigured() {
  return getInvitationStoreMode() === "database";
}

/**
 * The coordinator is available whenever the direct PostgreSQL backend is
 * configured. Its routes still require a configured password, signed session,
 * and same-origin mutation requests; hosting controls belong at the deployment
 * boundary rather than silently removing the management surface.
 */
export function isDatabaseCoordinatorMode() {
  return getInvitationStoreMode() === "database";
}
