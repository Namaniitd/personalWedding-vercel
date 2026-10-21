import { z } from "zod";

import { contactNumberSchema, rsvpDetailsSchema, validateRSVPForInvitation } from "../domain/rsvp.js";
import type { ResolvedInvitation, WeddingSide } from "../domain/types.js";
import { weddingSideSchema } from "../domain/wedding-side.js";
import { lockDatabaseContentAndInvitationIssue } from "./database-content-lock.js";
import { issueDatabaseInvitationInTransaction } from "./database-invitations.js";
import { getDatabasePool, saveDatabaseRSVPInTransaction } from "./database-rsvps.js";
import {
  databaseWeddingContact,
  loadDatabaseWeddingConfiguration,
  type DatabaseWeddingConfiguration
} from "./database-wedding-content.js";

export const publicInvitationLookupSchema = z.object({ side: weddingSideSchema }).strict();

export const publicRsvpSubmissionSchema = rsvpDetailsSchema.safeExtend({
  side: weddingSideSchema,
  contactNumber: contactNumberSchema.refine((value) => value.length > 0, "Enter a contact number.")
});

export class PublicRsvpValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicRsvpValidationError";
  }
}

/** Public pages expose only the events selected in the coordinator defaults. */
function resolvePublicConfiguration(configuration: DatabaseWeddingConfiguration, side: WeddingSide): ResolvedInvitation {
  const selected = configuration.events.filter((event) => event.defaultSelected);
  const contact = databaseWeddingContact(configuration, side);
  if (!selected.length || selected.length > 12 || !contact) throw new Error("Select between 1 and 12 published default celebrations and configure the reply-to contact before sharing a public invitation.");

  return {
    invitation: {
      kind: "public",
      side,
      // The shared guest form expects a syntactically valid token. This value
      // carries no authority and is never accepted as a private credential.
      token: `public-invitation-${side}`,
      householdName: { en: "You and your family", hi: "आप और आपका परिवार" },
      preferredLocale: "en",
      eventIds: selected.map(({ event }) => event.id),
      eventLimits: Object.fromEntries(selected.map(({ event, defaultAdults, defaultChildren }) => [
        event.id,
        { adults: defaultAdults, children: defaultChildren }
      ])),
      rsvpDeadline: configuration.rsvpDeadline,
      rsvpDeadlineIso: configuration.rsvpDeadlineIso,
      coordinator: contact
    },
    events: selected.map(({ event }) => event),
    wedding: configuration.wedding,
    rsvp: null
  };
}

export async function resolveDatabasePublicInvitation(side: WeddingSide) {
  return resolvePublicConfiguration(await loadDatabaseWeddingConfiguration(undefined, side), side);
}

/** Give each public response its own private edit credential in one transaction. */
export async function submitDatabasePublicRSVP(input: z.output<typeof publicRsvpSubmissionSchema>) {
  const parsed = publicRsvpSubmissionSchema.parse(input);
  const client = await getDatabasePool().connect();
  let transactionOpen = false;
  try {
    await client.query("begin");
    transactionOpen = true;
    await lockDatabaseContentAndInvitationIssue(client, parsed.side);
    const configuration = await loadDatabaseWeddingConfiguration(client, parsed.side);
    const publicInvitation = resolvePublicConfiguration(configuration, parsed.side);
    const { side, ...details } = parsed;
    const validation = validateRSVPForInvitation({ ...details, token: publicInvitation.invitation.token }, publicInvitation);
    if (!validation.ok) throw new PublicRsvpValidationError(validation.message);

    const issued = await issueDatabaseInvitationInTransaction(client, {
      householdNameEn: parsed.respondentName,
      preferredLocale: "en",
      contactRole: side,
      contactNumber: parsed.contactNumber,
      eventLimits: publicInvitation.invitation.eventIds.map((eventId) => ({
        eventId,
        ...publicInvitation.invitation.eventLimits[eventId]
      }))
    }, side, configuration);
    const saved = await saveDatabaseRSVPInTransaction(client, { ...details, token: issued.token });
    await client.query("commit");
    transactionOpen = false;

    const resolved: ResolvedInvitation = {
      ...publicInvitation,
      invitation: {
        ...publicInvitation.invitation,
        kind: "private",
        token: issued.token,
        householdName: issued.householdName,
        contactNumber: parsed.contactNumber
      },
      rsvp: saved.record,
      ...(saved.entryPass ? { entryPass: saved.entryPass } : {})
    };
    return { ...saved, resolved, token: issued.token };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the original error for the route's safe response.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
