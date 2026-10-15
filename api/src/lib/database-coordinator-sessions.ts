import { coordinatorSessionRequestSchema, type CoordinatorSessionRequest } from "../domain/coordinator-session.js";
import { getDatabasePool } from "./database-rsvps.js";

/** One narrowly granted operation shared by all API and frontend instances. */
export async function manageDatabaseCoordinatorSession(input: CoordinatorSessionRequest) {
  const parsed = coordinatorSessionRequestSchema.parse(input);
  const { rows } = await getDatabasePool().query<{ ok: boolean }>(
    "select wedding.coordinator_session($1::text, $2::text, $3::timestamptz, $4::text) as ok",
    [parsed.action, parsed.sessionHash, parsed.action === "register" ? parsed.expiresAt : null, parsed.side]
  );
  if (rows.length !== 1 || typeof rows[0]?.ok !== "boolean") {
    throw new Error("The coordinator session store is unavailable.");
  }
  return rows[0].ok;
}
