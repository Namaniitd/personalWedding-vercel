import { z } from "zod";

import type { Invitation, RSVPInput, ResolvedInvitation } from "@/lib/types";

export const invitationTokenSchema = z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/);

/** Keep familiar phone formatting while rejecting incomplete or non-phone values. */
export const contactNumberSchema = z.string().trim().max(40).refine((value) => {
  if (!value) return true;
  const digits = value.replace(/\D/g, "");
  return /^\+?[\d ()-]+$/.test(value) && digits.length >= 7 && digits.length <= 15;
}, { message: "Enter a contact number with 7 to 15 digits, including the country code if needed." });

export const rsvpDetailsSchema = z.object({
  respondentName: z.string().trim().min(2).max(100),
  contactNumber: contactNumberSchema.optional(),
  status: z.enum(["attending", "declined", "confirming"]),
  attendances: z
    .array(
      z.object({
        eventId: z.string().min(1).max(100),
        attending: z.boolean(),
        adults: z.number().int().min(0).max(30),
        children: z.number().int().min(0).max(30)
      }).strict()
    )
    .max(12),
  comfortNote: z.string().trim().max(500).optional(),
  declineMessage: z.string().trim().max(500).optional()
}).strict().superRefine((value, context) => {
  const seenEventIds = new Set<string>();
  value.attendances.forEach((attendance, index) => {
    if (seenEventIds.has(attendance.eventId)) {
      context.addIssue({
        code: "custom",
        message: "Each event can only appear once in an RSVP.",
        path: ["attendances", index, "eventId"]
      });
    }
    seenEventIds.add(attendance.eventId);
  });

  if (value.status !== "attending" && value.comfortNote) {
    context.addIssue({
      code: "custom",
      message: "Comfort notes are only collected for attending guests.",
      path: ["comfortNote"]
    });
  }
  if (value.status !== "declined" && value.declineMessage) {
    context.addIssue({
      code: "custom",
      message: "A message for the couple can only be sent with a declined RSVP.",
      path: ["declineMessage"]
    });
  }
});

export const rsvpSubmissionSchema = rsvpDetailsSchema.safeExtend({
  token: invitationTokenSchema,
  updatedAt: z.string().datetime().optional()
});

export type RSVPValidation =
  | { ok: true; value: RSVPInput }
  | { ok: false; message: string; field?: string };

export function validateRSVPForInvitation(
  value: RSVPInput,
  resolved: Pick<ResolvedInvitation, "invitation" | "events">
): RSVPValidation {
  const { invitation, events } = resolved;
  const allowedEventIds = new Set(events.map((event) => event.id));

  const deadline = new Date(invitation.rsvpDeadlineIso).getTime();
  if (!Number.isFinite(deadline) || deadline < Date.now()) {
    return { ok: false, message: "Online RSVPs are now closed. Please contact the coordination desk." };
  }

  const seenEventIds = new Set<string>();

  if (value.status !== "attending" && value.comfortNote?.trim()) {
    return { ok: false, message: "Comfort notes are only collected for attending guests." };
  }
  if (value.status !== "declined" && value.declineMessage?.trim()) {
    return { ok: false, message: "A message for the couple can only be sent with a declined RSVP." };
  }

  if (value.status !== "attending" && value.attendances.some((attendance) => attendance.attending)) {
    return { ok: false, message: "Please remove event attendance before submitting this response." };
  }

  let selectedEventCount = 0;
  for (const attendance of value.attendances) {
    if (seenEventIds.has(attendance.eventId)) {
      return { ok: false, message: "Each event can only appear once in an RSVP." };
    }
    seenEventIds.add(attendance.eventId);

    if (!allowedEventIds.has(attendance.eventId)) {
      return { ok: false, message: "This invitation does not include one of the selected events." };
    }

    const limits = invitation.eventLimits[attendance.eventId];
    if (!limits) {
      return { ok: false, message: "An attendance limit could not be found for this event." };
    }

    if (!attendance.attending && (attendance.adults > 0 || attendance.children > 0)) {
      return { ok: false, message: "Guest counts can only be added to an event you are attending." };
    }

    if (attendance.adults > limits.adults || attendance.children > limits.children) {
      return { ok: false, message: "One of the guest counts exceeds this invitation’s limit." };
    }

    if (attendance.attending) {
      selectedEventCount += 1;
      if (attendance.adults + attendance.children === 0) {
        return { ok: false, message: "Please add at least one guest to each selected event." };
      }
    }
  }

  // The form asks a household to explicitly answer every celebration. Keep
  // that contract at the server boundary too, so a crafted or stale request
  // cannot silently omit an event from catering and check-in planning.
  if (seenEventIds.size !== allowedEventIds.size) {
    return { ok: false, message: "Please answer yes or no for every celebration on this invitation." };
  }

  if (value.status === "attending" && selectedEventCount === 0) {
    return { ok: false, message: "Please select at least one event your family plans to attend." };
  }

  return { ok: true, value };
}

export function defaultAttendances(invitation: Invitation) {
  return invitation.eventIds.map((eventId) => ({
    eventId,
    attending: false,
    adults: 0,
    children: 0
  }));
}
