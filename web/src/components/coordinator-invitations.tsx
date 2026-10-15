"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CoordinatorContentSetup } from "@/components/coordinator-content-setup";
import { DatabaseInvitationIssuer as InvitationIssuer } from "@/components/database-invitation-issuer";
import type {
  DatabaseCoordinatorInvitation as CoordinatorInvitation,
  DatabaseInvitationIssuerOptions as InvitationIssuerOptions,
  WeddingSide
} from "@/lib/types";

export function CoordinatorInvitations({
  side,
  issuerOptions,
  invitations
}: {
  side: WeddingSide;
  issuerOptions: InvitationIssuerOptions;
  invitations: CoordinatorInvitation[];
}) {
  const router = useRouter();
  const [notice, setNotice] = useState("");

  function householdOf(invitation: CoordinatorInvitation) {
    return invitation.householdName[invitation.preferredLocale];
  }

  // The RSVP totals in the header and the response list live on other routes,
  // so refresh the server tree after any change here.
  function announce(message: string) {
    setNotice(message);
    router.refresh();
  }

  if (issuerOptions.events.length === 0) return <CoordinatorContentSetup side={side} />;

  return (
    <>
      <InvitationIssuer
        options={issuerOptions}
        initialInvitations={invitations}
        onIssued={(invitation) => announce(`A unique private link was created for ${householdOf(invitation)}. The raw URL is available only in the copy panel.`)}
        onRevoked={(invitation) => announce(`${householdOf(invitation)}'s invitation link was deleted and revoked. Its token can no longer resolve.`)}
        onRsvpDeleted={(invitation) => announce(`${householdOf(invitation)}'s RSVP was permanently deleted. The revoked invitation audit remains available below.`)}
      />
      <p className="admin-live-notice" role="status">{notice}</p>
    </>
  );
}
