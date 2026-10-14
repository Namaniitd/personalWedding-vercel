import type { PoolClient } from "pg";

/**
 * Serialize content saves with invitation issuance. Both operations acquire
 * this transaction lock before reading the schedule or changing a link, so an
 * archived event or disabled contact cannot gain one last active invitation.
 * The pair is reserved for this application within its PostgreSQL database.
 */
export async function lockDatabaseContentAndInvitationIssue(client: PoolClient) {
  await client.query("select pg_catalog.pg_advisory_xact_lock(683041, 1)");
}
