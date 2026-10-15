"use client";

import Link from "next/link";
import { useMemo } from "react";

import { activeInvitationRows, downloadCsv } from "@/lib/coordinator-rows";
import type { DatabaseCoordinatorInvitation as CoordinatorInvitation, DatabaseInvitationIssuerOptions, WeddingSide } from "@/lib/types";
import { coordinatorPath } from "@/lib/wedding-side";

export function CoordinatorFollowUps({ side, invitations, issuerOptions }: { side: WeddingSide; invitations: CoordinatorInvitation[]; issuerOptions: DatabaseInvitationIssuerOptions }) {
  const responsesPath = coordinatorPath(side, "responses");
  const rows = useMemo(() => activeInvitationRows(invitations), [invitations]);
  const pendingRows = useMemo(() => rows.filter((row) => row.state === "Pending"), [rows]);
  const confirmingRows = useMemo(() => rows.filter((row) => row.state === "Confirming"), [rows]);
  // A household that has replied but is still undecided needs a clear,
  // final-answer reminder before cold outreach to people who have not replied.
  const followUpRows = useMemo(() => [...confirmingRows, ...pendingRows], [confirmingRows, pendingRows]);
  const nextFollowUp = confirmingRows[0] ?? pendingRows[0];
  const nextIsConfirming = nextFollowUp?.state === "Confirming";

  return (
    <>
      <section className="admin-workspace-heading admin-page-heading" aria-labelledby="follow-ups-title">
        <div>
          <p>Next steps</p>
          <h1 id="follow-ups-title">Follow-ups</h1>
          <span>{followUpRows.length} household{followUpRows.length === 1 ? "" : "s"} need a reply or final confirmation.</span>
        </div>
        <div className="admin-workspace-heading-actions">
          <Link href={`${responsesPath}?filter=Needs%20follow-up`} prefetch={false} className="admin-outline-button">View all follow-ups <span aria-hidden="true">→</span></Link>
        </div>
      </section>

      <section className="admin-notes-grid" aria-label="Coordinator next steps">
        <article className="admin-followup-card">
          <span>{nextIsConfirming ? "Confirm next" : "Follow-up next"}</span>
          {nextFollowUp ? <>
            <h2>{nextFollowUp.household}</h2>
            <p>{nextIsConfirming
              ? "They replied that they will confirm soon. Send a personal WhatsApp reminder for their final attendance plan, then refresh this workspace to review the saved outcome."
              : "Still awaiting a reply. Send a personal WhatsApp reminder, then refresh this coordinator workspace to review the saved outcome."}</p>
            <Link href={`${responsesPath}?search=${encodeURIComponent(nextFollowUp.household)}`} prefetch={false}>View household <span aria-hidden="true">→</span></Link>
          </> : <>
            <h2>All caught up</h2>
            <p>No active household currently needs a reply or final confirmation. Export a fresh list before your final vendor check-in.</p>
            <button type="button" onClick={() => downloadCsv(invitations, issuerOptions)}>Download current CSV <span aria-hidden="true">→</span></button>
          </>}
        </article>
        <article className="admin-backup-card">
          <span>Wedding-day backup</span>
          <h2>Export once more at T−3 days</h2>
          <p>Keep a printed list of attending households, special requests, and coordination contacts with the venue team.</p>
          <button type="button" onClick={() => downloadCsv(invitations, issuerOptions)}>Download current CSV <span aria-hidden="true">↓</span></button>
        </article>
      </section>

      {followUpRows.length > 0 && (
        <section className="admin-workspace" aria-labelledby="follow-up-queue-title">
          <div className="admin-workspace-heading">
            <div>
              <p>Queue</p>
              <h2 id="follow-up-queue-title">Households needing a reply or confirmation</h2>
            </div>
          </div>
          <div className="admin-table-wrap">
            <table>
              <caption className="sr-only">Households that need a reply or final confirmation.</caption>
              <thead><tr><th scope="col">Household</th><th scope="col">Invitation group</th><th scope="col">Follow-up</th><th scope="col">Last update</th><th scope="col">Open</th></tr></thead>
              <tbody>
                {followUpRows.map((row) => <tr key={row.id}>
                  <td data-label="Household"><strong>{row.household}</strong></td>
                  <td data-label="Invitation group">{row.group}</td>
                  <td data-label="Follow-up"><strong>{row.state === "Confirming" ? "Confirm attendance" : "Request RSVP"}</strong></td>
                  <td data-label="Last update">{row.updated}</td>
                  <td data-label="Open"><Link href={`${responsesPath}?search=${encodeURIComponent(row.household)}`} prefetch={false}>View <span aria-hidden="true">→</span></Link></td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
