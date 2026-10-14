import type { CoordinatorSessionRequest } from "../domain/coordinator-session.js";
import { getDatabasePool } from "./database-rsvps.js";

/** One narrowly granted operation shared by all API and frontend instances. */
export async function manageDatabaseCoordinatorSession(input: CoordinatorSessionRequest) {
  const { rows } = await getDatabasePool().query<{ ok: boolean }>(
    "select wedding.coordinator_session($1::text, $2::text, $3::timestamptz) as ok",
    [input.action, input.sessionHash, input.action === "register" ? input.expiresAt : null]
  );
  if (rows.length !== 1 || typeof rows[0]?.ok !== "boolean") {
    throw new Error("The coordinator session store is unavailable.");
  }
  return rows[0].ok;
}
