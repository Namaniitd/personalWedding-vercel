"use client";

import Link from "next/link";

import { CoordinatorContentSetup } from "@/components/coordinator-content-setup";
import { activeInvitationRows, downloadCsv, summariseEventAttendance, summariseRows } from "@/lib/coordinator-rows";
import type {
  DatabaseCoordinatorInvitation as CoordinatorInvitation,
  DatabaseInvitationIssuerOptions,
  WeddingSide
} from "@/lib/types";
import { coordinatorPath } from "@/lib/wedding-side";

const workspaceLinks = [
  {
    path: "content",
    eyebrow: "Wedding details",
    title: "Invitation content",
    copy: "Update names, timing, contacts, event details, and what guests see on their invitation."
  },
  {
    path: "check-in",
    eyebrow: "On the day",
    title: "Gate check-in",
    copy: "Scan welcome passes at the door, or accept a manual code when a camera is unavailable."
  },
  {
    path: "invitations",
    eyebrow: "Before the day",
    title: "Invite links",
    copy: "Create a unique private link per household, then copy, share, or revoke it."
  },
  {
    path: "responses",
    eyebrow: "Replies",
    title: "Household RSVPs",
    copy: "Filter, search, and sort household replies, then export a clean handover list."
  },
  {
    path: "follow-ups",
    eyebrow: "Next steps",
    title: "Follow-ups",
    copy: "See who still owes a reply and keep a wedding-day backup export ready."
  }
];

export function CoordinatorOverview({
  side,
  invitations,
  issuerOptions
}: {
  side: WeddingSide;
  invitations: CoordinatorInvitation[];
  issuerOptions: DatabaseInvitationIssuerOptions;
}) {
  const rows = activeInvitationRows(invitations);
  const totals = summariseRows(rows);
  const eventTotals = summariseEventAttendance(invitations, issuerOptions.events);
  const followUpSummary = totals.followUps === 0
    ? "No households need follow-up"
    : `${totals.followUps} household${totals.followUps === 1 ? "" : "s"} awaiting a reply or confirmation`;
  const followUpBreakdown = totals.followUps === 0
    ? "No outreach needed"
    : `${totals.pending} awaiting reply · ${totals.confirming} confirming`;

  return (
    <>
      <section className="admin-intro" aria-labelledby="coordinator-title">
        <div className="admin-intro-copy">
          <p>Coordinator workspace</p>
          <h1 id="coordinator-title">A calmer way to manage every RSVP.</h1>
          <span>Review household replies, focus follow-ups, and export a clean handover list for the wedding team.</span>
          <div className="admin-intro-meta" aria-label="Workspace summary">
            <span><i aria-hidden="true" /> Private workspace</span>
            <span>{totals.responseRate}% reply rate</span>
          </div>
        </div>
        <div className="admin-intro-actions">
          <Link href={coordinatorPath(side, "follow-ups")} prefetch={false} className="admin-priority-card">
            <span>Needs attention</span>
            <strong>{followUpSummary}</strong>
            <small>Review follow-ups <b aria-hidden="true">→</b></small>
          </Link>
          <div className="admin-actions">
            <button type="button" className="admin-outline-button" onClick={() => downloadCsv(invitations, issuerOptions)}>Export CSV <span aria-hidden="true">↓</span></button>
          </div>
        </div>
      </section>

      <section className="admin-metrics" aria-label="RSVP summary">
        <article><span>Households</span><strong>{totals.invited}</strong><small>Invitation records</small></article>
        <article><span>Replies received</span><strong>{totals.replied}</strong><small>{totals.responseRate}% of households</small></article>
        <article><span>Needs follow-up</span><strong>{totals.followUps}</strong><small>{followUpBreakdown}</small></article>
        <article><span>Planned attendance</span><strong>{totals.attendees}</strong><small>Guest counts across all events</small></article>
      </section>

      {issuerOptions.events.length === 0 ? <CoordinatorContentSetup side={side} /> : <section className="admin-event-totals" aria-labelledby="event-totals-title">
        <div className="admin-event-totals-heading">
          <div>
            <p>Catering snapshot</p>
            <h2 id="event-totals-title">Guest plans by celebration</h2>
          </div>
          <span>From active guest RSVPs marked attending; counts are self-reported.</span>
        </div>
        <div className="admin-event-total-grid">
          {eventTotals.map((event) => (
            <article key={event.id}>
              <p>{event.title}</p>
              <strong>{event.total}</strong>
              <span>guest{event.total === 1 ? "" : "s"} planning to attend</span>
              <dl>
                <div><dt>{event.adults}</dt><dd>Adults</dd></div>
                <div><dt>{event.children}</dt><dd>Children</dd></div>
              </dl>
              <small>{event.households} household{event.households === 1 ? "" : "s"} {event.households === 1 ? "plans" : "plan"} to attend</small>
            </article>
          ))}
        </div>
      </section>}

      <section className="admin-section-grid" aria-labelledby="coordinator-sections-title">
        <div className="admin-section-grid-heading">
          <p>Workspace</p>
          <h2 id="coordinator-sections-title">Where would you like to go?</h2>
        </div>
        <div className="admin-section-cards">
          {workspaceLinks.map((link) => (
            <Link key={link.path} href={coordinatorPath(side, link.path)} prefetch={false} className="admin-section-card">
              <span>{link.eyebrow}</span>
              <strong>{link.title}</strong>
              <small>{link.copy}</small>
              <b aria-hidden="true">→</b>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
