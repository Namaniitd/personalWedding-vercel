import type { PoolClient } from "pg";
import type { WeddingSide } from "../domain/types.js";
import { weddingSideSettingsId } from "../domain/wedding-side.js";

/**
 * Serialize content saves with invitation issuance. Both operations acquire
 * this transaction lock before reading the schedule or changing a link, so an
 * archived event or disabled contact cannot gain one last active invitation.
 * The pair is reserved for this application within its PostgreSQL database.
 */
export async function lockDatabaseContentAndInvitationIssue(client: PoolClient, side: WeddingSide = "groom") {
  await client.query("select pg_catalog.pg_advisory_xact_lock(683041, $1)", [weddingSideSettingsId(side)]);
}
