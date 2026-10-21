import type {
  DatabaseCoordinatorInvitation as CoordinatorInvitation,
  DatabaseInvitationEventOption,
  DatabaseInvitationIssuerOptions
} from "@/lib/types";

/**
 * These are deliberately coordinator-facing states, rather than a direct
 * mirror of the guest form. A guest who says they will confirm soon has
 * replied, but their household still needs action from the coordination team.
 */
export type InvitationState = "Pending" | "Confirming" | "Responded" | "Declined";
export type RSVPFilter = InvitationState | "All" | "Needs follow-up";
export type SortOption = "recent" | "household" | "guests";

export type GuestRow = {
  id: string;
  invitationId: string;
  household: string;
  contactNumber: string;
  group: string;
  events: number;
  adults: number;
  children: number;
  state: InvitationState;
  updated: string;
  updatedAt: string;
};

/** A catering-safe aggregate. It deliberately includes no RSVP notes or raw
 * invitation data, so it can be rendered in the ordinary coordinator view. */
export type EventAttendanceSummary = {
  id: string;
  title: string;
  households: number;
  adults: number;
  children: number;
  total: number;
};

export const filterOptions: RSVPFilter[] = ["All", "Needs follow-up", "Pending", "Confirming", "Responded", "Declined"];
const attendingStates: InvitationState[] = ["Responded"];

export function getGuestCount(row: GuestRow) {
  return row.adults + row.children;
}

/** A response that is absent or explicitly provisional belongs in the call list. */
export function needsFollowUp(state: InvitationState) {
  return state === "Pending" || state === "Confirming";
}

export function matchesRSVPFilter(row: GuestRow, filter: RSVPFilter) {
  if (filter === "All") return true;
  if (filter === "Needs follow-up") return needsFollowUp(row.state);
  return row.state === filter;
}

function replyToLabel(contactRole: CoordinatorInvitation["contactRole"]) {
  return contactRole === "bride" ? "Bride reply-to" : "Groom reply-to";
}

export function invitationRow(invitation: CoordinatorInvitation): GuestRow {
  const participating = invitation.rsvp?.attendances.filter((attendance) => attendance.attending) ?? [];
  const adults = participating.reduce((total, attendance) => total + attendance.adults, 0);
  const children = participating.reduce((total, attendance) => total + attendance.children, 0);
  const state: InvitationState = invitation.rsvp
    ? invitation.rsvp.status === "declined"
      ? "Declined"
      : invitation.rsvp.status === "confirming"
        ? "Confirming"
        : "Responded"
    : "Pending";
  return {
    id: `invitation-${invitation.id}`,
    invitationId: invitation.id,
    household: invitation.householdName[invitation.preferredLocale],
    contactNumber: invitation.rsvp ? invitation.rsvp.contactNumber ?? "" : invitation.contactNumber ?? "",
    group: `Invitation link · ${replyToLabel(invitation.contactRole)} · ${invitation.eventCount} invited event${invitation.eventCount === 1 ? "" : "s"}`,
    events: participating.length,
    adults,
    children,
    state,
    updated: (invitation.rsvp?.updatedAt ?? invitation.createdAt).slice(0, 10),
    updatedAt: invitation.rsvp?.updatedAt ?? invitation.createdAt
  };
}

export function activeInvitationRows(invitations: CoordinatorInvitation[]) {
  return invitations
    .filter((invitation) => invitation.status === "active")
    .map(invitationRow);
}

export function summariseRows(rows: GuestRow[]) {
  const replied = rows.filter((row) => row.state !== "Pending").length;
  const attending = rows.filter((row) => attendingStates.includes(row.state));
  const pending = rows.filter((row) => row.state === "Pending").length;
  const confirming = rows.filter((row) => row.state === "Confirming").length;
  return {
    invited: rows.length,
    replied,
    pending,
    confirming,
    followUps: pending + confirming,
    attendees: attending.reduce((total, row) => total + getGuestCount(row), 0),
    responseRate: rows.length ? Math.round((replied / rows.length) * 100) : 0
  };
}

/**
 * Turn household RSVP snapshots into the per-celebration numbers a venue and
 * caterer need. Only active invitations with a final attending RSVP count;
 * provisional and revoked records must never inflate operational totals.
 */
export function summariseEventAttendance(
  invitations: CoordinatorInvitation[],
  events: DatabaseInvitationEventOption[]
): EventAttendanceSummary[] {
  const summaries = new Map(events.map((event) => [event.id, {
    id: event.id,
    title: event.title.en,
    households: 0,
    adults: 0,
    children: 0,
    total: 0
  }]));

  for (const invitation of invitations) {
    if (invitation.status !== "active" || invitation.rsvp?.status !== "attending") continue;
    for (const attendance of invitation.rsvp.attendances) {
      if (!attendance.attending) continue;
      const summary = summaries.get(attendance.eventId);
      if (!summary) continue;
      summary.households += 1;
      summary.adults += attendance.adults;
      summary.children += attendance.children;
      summary.total += attendance.adults + attendance.children;
    }
  }

  return events.flatMap((event) => {
    const summary = summaries.get(event.id);
    return summary ? [summary] : [];
  });
}

export function sortCoordinatorRows(rows: GuestRow[], sort: SortOption) {
  return [...rows].sort((first, second) => {
    if (sort === "household") return first.household.localeCompare(second.household);
    if (sort === "guests") return getGuestCount(second) - getGuestCount(first) || first.household.localeCompare(second.household);
    return new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime();
  });
}

export function buildCoordinatorCsv(invitations: CoordinatorInvitation[], options: DatabaseInvitationIssuerOptions) {
  const heading = ["Household", "Event", "RSVP state", "Event attendance", "Adults", "Children", "Respondent", "Hospitality requests", "Message for the couple", "Coordinator", "Coordinator phone", "Last update", "Guest contact number"];
  // Prefix spreadsheet formulas so database-provided text cannot execute when
  // the exported CSV is opened in Excel or Google Sheets.
  const quote = (value: string | number) => {
    const text = String(value);
    const safeText = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replace(/"/g, '""')}"`;
  };
  const rows = invitations.filter((invitation) => invitation.status === "active").flatMap((invitation) => {
    const response = invitation.rsvp;
    const coordinator = options.contactOptions.find((contact) => contact.role === invitation.contactRole);
    return invitation.eventLimits.map((limit) => {
      const event = options.events.find((candidate) => candidate.id === limit.eventId);
      const attendance = response?.attendances.find((candidate) => candidate.eventId === limit.eventId);
      const attending = response?.status === "attending" && attendance?.attending;
      return [invitation.householdName[invitation.preferredLocale], event?.title.en ?? "Unavailable celebration",
        invitationRow(invitation).state, !response ? "Awaiting reply" : response.status === "confirming" ? "Awaiting confirmation" : attending ? "Attending" : "Not attending",
        attending ? attendance.adults : 0, attending ? attendance.children : 0, response?.respondentName ?? "",
        response?.status === "attending" ? response.comfortNote ?? "" : "",
        response?.status === "declined" ? response.declineMessage ?? "" : "",
        coordinator?.name ?? "", coordinator?.phoneDisplay ?? "", response?.updatedAt ?? invitation.createdAt,
        response ? response.contactNumber ?? "" : invitation.contactNumber ?? ""];
    });
  });
  return [heading, ...rows]
    .map((line) => line.map(quote).join(","))
    .join("\n");
}

export function downloadCsv(invitations: CoordinatorInvitation[], options: DatabaseInvitationIssuerOptions) {
  const csv = buildCoordinatorCsv(invitations, options);
  // A UTF-8 BOM keeps Hindi names readable when this backup is opened in Excel.
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "shaadi-companion-rsvp.csv";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
