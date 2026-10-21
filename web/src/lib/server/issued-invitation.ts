import { z } from "zod";

import { invitationTokenSchema } from "@/lib/rsvp";
import { invitationPath } from "@/lib/wedding-side";
import type { WeddingSide } from "@/lib/types";

export const issuedInvitationSchema = z.object({
  id: z.string().uuid(),
  token: invitationTokenSchema,
  createdAt: z.string().datetime(),
  householdName: z.object({ en: z.string(), hi: z.string() }).strict(),
  eventCount: z.number().int().min(1).max(12),
  contactRole: z.enum(["groom", "bride"]),
  contactNumber: z.string().max(40).optional(),
  side: z.enum(["groom", "bride"]).optional()
}).strict();

export function browserIssuedInvitation(issued: z.infer<typeof issuedInvitationSchema>, side: WeddingSide, origin: string) {
  if ((issued.side ?? "groom") !== side) throw new Error("Invalid invitation owner.");
  return {
    invitationId: issued.id,
    createdAt: issued.createdAt,
    invitationUrl: new URL(invitationPath(side, issued.token), origin).toString(),
    householdName: issued.householdName,
    eventCount: issued.eventCount,
    contactRole: issued.contactRole,
    ...(issued.contactNumber ? { contactNumber: issued.contactNumber } : {})
  };
}
