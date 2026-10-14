import { z } from "zod";

import type { DatabaseCoordinatorInvitation } from "@/lib/types";

/** Manual replies use a coordinator session and invitation ID, never a bearer link. */
export const coordinatorRsvpSchema = z.object({
  invitationId: z.string().uuid(),
  respondentName: z.string().trim().min(2).max(100),
  status: z.enum(["attending", "declined", "confirming"]),
  attendances: z.array(z.object({
    eventId: z.string().min(1).max(100),
    attending: z.boolean(),
    adults: z.number().int().min(0).max(30),
    children: z.number().int().min(0).max(30)
  }).strict()).min(1).max(12),
  comfortNote: z.string().trim().max(500).optional(),
  declineMessage: z.string().trim().max(500).optional(),
  expectedUpdatedAt: z.string().datetime().nullable()
}).strict().superRefine((value, context) => {
  const ids = value.attendances.map((attendance) => attendance.eventId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "Each celebration can appear only once." });
  if (value.status !== "attending" && value.comfortNote) context.addIssue({ code: "custom", message: "Comfort notes require an attending reply." });
  if (value.status !== "declined" && value.declineMessage) context.addIssue({ code: "custom", message: "A message for the couple requires a declined reply." });
});

export type CoordinatorRsvpInput = z.infer<typeof coordinatorRsvpSchema>;

export function coordinatorRsvpDraft(invitation: DatabaseCoordinatorInvitation): CoordinatorRsvpInput {
  const existing = invitation.rsvp;
  return {
    invitationId: invitation.id,
    respondentName: existing?.respondentName ?? "",
    status: existing?.status ?? "attending",
    attendances: invitation.eventLimits.map((limit) => existing?.attendances.find((attendance) => attendance.eventId === limit.eventId) ?? {
      eventId: limit.eventId, attending: false, adults: 0, children: 0
    }),
    comfortNote: existing?.comfortNote ?? "",
    declineMessage: existing?.declineMessage ?? "",
    expectedUpdatedAt: existing?.updatedAt ?? null
  };
}

/** Keep date cutoffs out of this path: coordinators can record a phone reply after closing. */
export function coordinatorRsvpValidation(input: CoordinatorRsvpInput, invitation: DatabaseCoordinatorInvitation): string | null {
  if (invitation.status !== "active") return "A revoked invitation cannot receive an RSVP.";
  if (!coordinatorRsvpSchema.safeParse(input).success) return "Enter the respondent’s name and review the RSVP details.";
  if (input.attendances.length !== invitation.eventLimits.length) return "Answer every celebration on this invitation.";
  for (const attendance of input.attendances) {
    const limit = invitation.eventLimits.find((candidate) => candidate.eventId === attendance.eventId);
    if (!limit) return "This celebration is not on the household’s invitation.";
    if (attendance.adults > limit.adults || attendance.children > limit.children) return "A guest count exceeds this invitation’s limit.";
    if (!attendance.attending && attendance.adults + attendance.children > 0) return "Clear the guest count for celebrations they will not attend.";
    if (attendance.attending && attendance.adults + attendance.children === 0) return "Add at least one guest to every selected celebration.";
    if (input.status !== "attending" && attendance.attending) return "Clear attendance for a declined or provisional reply.";
  }
  if (input.status === "attending" && !input.attendances.some((attendance) => attendance.attending)) return "Choose at least one celebration they will attend.";
  return null;
}
