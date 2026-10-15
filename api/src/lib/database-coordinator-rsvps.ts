import { z } from "zod";

import { rsvpDetailsSchema } from "../domain/rsvp.js";
import { getDatabasePool } from "./database-rsvps.js";
import type { WeddingSide } from "../domain/types.js";
import { requireWeddingSide } from "../domain/wedding-side.js";

export const coordinatorRsvpSubmissionSchema = rsvpDetailsSchema.safeExtend({
  invitationId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime().nullable()
});

export type CoordinatorRsvpSubmission = z.infer<typeof coordinatorRsvpSubmissionSchema>;
export type CoordinatorRsvpSaveResult =
  | { kind: "saved"; updatedAt: string }
  | { kind: "stale" | "not_found" | "invalid" };

/** The dedicated, audited SQL operation is the only path that bypasses the guest cutoff. */
export async function saveDatabaseCoordinatorRSVP(input: CoordinatorRsvpSubmission, side: WeddingSide = "groom"): Promise<CoordinatorRsvpSaveResult> {
  requireWeddingSide(side);
  const parsed = coordinatorRsvpSubmissionSchema.parse(input);
  const { invitationId, expectedUpdatedAt, ...details } = parsed;
  const { rows } = await getDatabasePool().query<{ outcome: string; updated_at: Date | string | null }>(
    "select outcome, updated_at from wedding.save_coordinator_rsvp($1::uuid, $2::jsonb, $3::timestamptz, $4::text)",
    [invitationId, JSON.stringify(details), expectedUpdatedAt, side]
  );
  const row = rows[0];
  if (row?.outcome === "saved" && row.updated_at) {
    const timestamp = new Date(row.updated_at);
    if (!Number.isFinite(timestamp.getTime())) throw new Error("The coordinator RSVP timestamp is invalid.");
    return { kind: "saved", updatedAt: timestamp.toISOString() };
  }
  if (row?.outcome === "stale" || row?.outcome === "not_found" || row?.outcome === "invalid") {
    return { kind: row.outcome };
  }
  throw new Error("The coordinator RSVP was not saved.");
}
