import type { Metadata } from "next";

import { CoordinatorResponses } from "@/components/coordinator-responses";
import { requireCoordinatorWorkspace } from "@/lib/server/coordinator-access";
import { filterOptions, type RSVPFilter } from "@/lib/coordinator-rows";

export const metadata: Metadata = { title: "Responses" };

function readFilter(value: string | string[] | undefined): RSVPFilter {
  const candidate = Array.isArray(value) ? value[0] : value;
  return filterOptions.find((option) => option === candidate) ?? "All";
}

function readSearch(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" ? candidate.slice(0, 120) : "";
}

export default async function CoordinatorResponsesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ invitations, issuerOptions }, params] = await Promise.all([
    requireCoordinatorWorkspace(),
    searchParams
  ]);
  // Keep identical labels during hydration: browser locale punctuation varies.
  const updatedAtLabels = Object.fromEntries(invitations.map((invitation) => [
    invitation.id,
    `${new Date(invitation.rsvp?.updatedAt ?? invitation.createdAt).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short"
    })} IST`
  ]));
  return (
    <CoordinatorResponses
      invitations={invitations}
      issuerOptions={issuerOptions}
      updatedAtLabels={updatedAtLabels}
      initialFilter={readFilter(params.filter)}
      initialSearch={readSearch(params.search)}
    />
  );
}
