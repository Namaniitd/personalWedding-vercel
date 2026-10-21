"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CoordinatorContentSetup } from "@/components/coordinator-content-setup";
import { DatabaseInvitationIssuer as InvitationIssuer } from "@/components/database-invitation-issuer";
import { weddingSideCode } from "@/lib/wedding-side";
import type {
  DatabaseCoordinatorInvitation as CoordinatorInvitation,
  DatabaseInvitationIssuerOptions as InvitationIssuerOptions,
  WeddingSide
} from "@/lib/types";
import styles from "./database-invitation-share.module.css";

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
  const publicPath = `/rsvp/${weddingSideCode(side)}`;
  const publishedEventIds = new Set(issuerOptions.events.map((event) => event.id));
  const publicEventCount = issuerOptions.defaultEventLimits.filter((limit) => publishedEventIds.has(limit.eventId)).length;
  const publicLinkAvailable = publicEventCount >= 1 && publicEventCount <= 12;

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
      <section className={`database-invitation-issuer ${styles.publicPanel}`} aria-labelledby="public-invitation-title">
        <div className="database-invitation-issuer-heading"><div><p>Reusable invitation</p><h2 id="public-invitation-title">Share a public RSVP link</h2><span>Anyone with this link can RSVP for their household. You do not need to create an invitation first.</span></div></div>
        <p>Guests enter their name and contact number, then receive a personal link to view or update their response. Public RSVPs appear alongside private invitations in your response list.</p>
        <p>This link uses the default celebrations and guest limits in <a href={`/coordinator/${weddingSideCode(side)}/content`}>Wedding content</a>.</p>
        {!publicLinkAvailable && <p role="status">Select between 1 and 12 published celebrations as defaults in <a href={`/coordinator/${weddingSideCode(side)}/content`}>Wedding content</a> to enable this public RSVP link. Currently, {publicEventCount} published celebration{publicEventCount === 1 ? " is" : "s are"} selected by default.</p>}
        <div className="database-invitation-copy-row">{publicLinkAvailable ? <a href={publicPath} target="_blank" rel="noopener noreferrer">Open public invitation · {publicPath} ↗</a> : <span aria-disabled="true">Public invitation unavailable · {publicPath}</span>}<button type="button" className="admin-primary-button" disabled={!publicLinkAvailable} onClick={async () => {
          if (!publicLinkAvailable) return;
          try { await navigator.clipboard.writeText(new URL(publicPath, window.location.origin).toString()); setNotice("Public RSVP link copied. Anyone you share it with can RSVP."); }
          catch { setNotice("Open the public invitation and copy its address to share it."); }
        }}>Copy public RSVP link</button></div>
      </section>
      <InvitationIssuer
        options={issuerOptions}
        initialInvitations={invitations}
        onIssued={(invitation) => announce(`A unique private link was created for ${householdOf(invitation)}. The raw URL is available only in the copy panel.`)}
        onBulkIssued={(count) => announce(`${count} private invitation links created. Download or copy them before closing the one-time links panel.`)}
        onRevoked={(invitation) => announce(`${householdOf(invitation)}'s invitation link was deleted and revoked. Its token can no longer resolve.`)}
        onRsvpDeleted={(invitation) => announce(`${householdOf(invitation)}'s RSVP was permanently deleted. The revoked invitation audit remains available below.`)}
      />
      <p className="admin-live-notice" role="status">{notice}</p>
    </>
  );
}
