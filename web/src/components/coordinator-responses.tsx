"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { CoordinatorRSVPEditor } from "@/components/coordinator-rsvp-editor";

import {
  activeInvitationRows,
  downloadCsv,
  filterOptions,
  matchesRSVPFilter,
  sortCoordinatorRows,
  type RSVPFilter,
  type SortOption
} from "@/lib/coordinator-rows";
import type { DatabaseCoordinatorInvitation as CoordinatorInvitation, DatabaseInvitationIssuerOptions } from "@/lib/types";

export function CoordinatorResponses({
  invitations,
  issuerOptions,
  updatedAtLabels,
  initialFilter,
  initialSearch
}: {
  invitations: CoordinatorInvitation[];
  issuerOptions: DatabaseInvitationIssuerOptions;
  updatedAtLabels: Record<string, string>;
  initialFilter: RSVPFilter;
  initialSearch: string;
}) {
  const rows = useMemo(() => activeInvitationRows(invitations), [invitations]);
  const router = useRouter();
  const [filter, setFilter] = useState<RSVPFilter>(initialFilter);
  const [search, setSearch] = useState(initialSearch);
  const [sort, setSort] = useState<SortOption>("recent");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isEditingSaving, setIsEditingSaving] = useState(false);
  const editingInvitation = invitations.find((invitation) => invitation.id === editingId && invitation.status === "active");

  const filteredRows = useMemo(() => rows.filter((row) => {
    const matchesFilter = matchesRSVPFilter(row, filter);
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || row.household.toLowerCase().includes(term) || row.group.toLowerCase().includes(term) || row.contactNumber.toLowerCase().includes(term);
    return matchesFilter && matchesSearch;
  }), [filter, rows, search]);

  const visibleRows = useMemo(() => sortCoordinatorRows(filteredRows, sort), [filteredRows, sort]);

  const filterCounts = useMemo<Record<RSVPFilter, number>>(() => ({
    All: rows.length,
    "Needs follow-up": rows.filter((row) => matchesRSVPFilter(row, "Needs follow-up")).length,
    Pending: rows.filter((row) => row.state === "Pending").length,
    Confirming: rows.filter((row) => row.state === "Confirming").length,
    Responded: rows.filter((row) => row.state === "Responded").length,
    Declined: rows.filter((row) => row.state === "Declined").length
  }), [rows]);

  const hasActiveView = filter !== "All" || Boolean(search.trim()) || sort !== "recent";

  function resetView() {
    setFilter("All");
    setSearch("");
    setSort("recent");
    setNotice("Showing all RSVP records.");
  }

  return (
    <section className="admin-workspace" aria-labelledby="rsvp-records-title">
      <div className="admin-workspace-heading">
        <div>
          <p>Response list</p>
          <h1 id="rsvp-records-title">Household RSVPs</h1>
          <span aria-live="polite">{visibleRows.length} of {rows.length} household{rows.length === 1 ? "" : "s"} shown</span>
        </div>
        <div className="admin-workspace-heading-actions">
          {hasActiveView && <button type="button" className="admin-reset-view" onClick={resetView}>Clear view <span aria-hidden="true">×</span></button>}
          <button type="button" className="admin-outline-button" onClick={() => downloadCsv(invitations, issuerOptions)}>Export CSV <span aria-hidden="true">↓</span></button>
        </div>
      </div>
      <div className="admin-toolbar">
        <div className="admin-filter-group">
          <span className="admin-control-label">Filter households</span>
          <div className="admin-tabs" role="group" aria-label="Filter RSVP records by response and follow-up state">
            {filterOptions.map((state) => <button
              key={state}
              type="button"
              aria-pressed={filter === state}
              className={filter === state ? "is-active" : ""}
              onClick={() => setFilter(state)}
            >{state}<span>{filterCounts[state]}</span></button>)}
          </div>
        </div>
        <div className="admin-table-tools">
          <label className="admin-search">
            <span className="sr-only">Search RSVP records</span>
            <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, number or group" />
            {search && <button type="button" aria-label="Clear search" onClick={() => setSearch("")}>×</button>}
          </label>
          <label className="admin-sort">
            <span className="sr-only">Sort RSVP records</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as SortOption)} aria-label="Sort RSVP records">
              <option value="recent">Recent activity</option>
              <option value="household">Household A–Z</option>
              <option value="guests">Guests, high to low</option>
            </select>
          </label>
        </div>
      </div>

      <div className="admin-table-wrap">
        <table>
          <caption className="sr-only">RSVP records from public and private invitations.</caption>
          <thead><tr><th scope="col">Household</th><th scope="col">Invitation group</th><th scope="col">Attendance</th><th scope="col">RSVP state</th><th scope="col">Reply details</th><th scope="col">Last update</th><th scope="col">Record / edit</th></tr></thead>
          <tbody>
            {visibleRows.map((row) => {
              const invitation = invitations.find((candidate) => candidate.id === row.invitationId);
              const response = invitation?.rsvp;
              return <tr key={row.id}>
              <td data-label="Household"><strong>{row.household}</strong>{row.contactNumber && <small>{row.contactNumber}</small>}</td>
              <td data-label="Invitation group">{row.group}</td>
              <td data-label="Attendance"><b>{row.events}</b> event{row.events === 1 ? "" : "s"}<small>{row.adults} adults · {row.children} children</small></td>
              <td data-label="RSVP state"><span className={`status-pill status-${row.state.toLowerCase().replace(/\s/g, "-")}`}>{row.state}</span></td>
              <td data-label="Reply details" className="admin-reply-details">{response ? <details><summary>{response.respondentName || "View reply"}</summary>
                <p><strong>Respondent</strong>{response.respondentName}</p>
                {response.status === "attending" && response.comfortNote && <p><strong>Hospitality requests</strong>{response.comfortNote}</p>}
                {response.status === "declined" && response.declineMessage && <p><strong>Message for the couple</strong>{response.declineMessage}</p>}
                {response.attendances.map((attendance) => <p key={attendance.eventId}><strong>{issuerOptions.events.find((event) => event.id === attendance.eventId)?.title.en ?? "Unavailable celebration"}</strong>{attendance.attending ? `${attendance.adults} adults · ${attendance.children} children` : response.status === "confirming" ? "Awaiting confirmation" : "Not attending"}</p>)}
              </details> : "No reply yet"}</td>
              <td data-label="Last update"><time dateTime={row.updatedAt}>{updatedAtLabels[row.invitationId]}</time></td>
              <td data-label="Record / edit"><button type="button" className="admin-outline-button" disabled={isEditingSaving} aria-expanded={editingId === row.invitationId} onClick={() => setEditingId(row.invitationId)}>{response ? "Review / edit reply" : "Record reply"}</button></td>
            </tr>;
            })}
            {visibleRows.length === 0 && <tr><td className="empty-table" colSpan={7}><div><strong>No households match this view.</strong><span>Try another reply filter or clear your search.</span>{hasActiveView && <button type="button" onClick={resetView}>Reset filters</button>}</div></td></tr>}
          </tbody>
        </table>
      </div>
      {editingInvitation && <CoordinatorRSVPEditor key={`${editingInvitation.id}:${editingInvitation.rsvp?.updatedAt ?? "new"}`}
        invitation={editingInvitation} events={issuerOptions.events}
        onSavingChange={setIsEditingSaving}
        onCancel={() => setEditingId(null)}
        onSaved={() => { setEditingId(null); setNotice(`Reply saved for ${editingInvitation.householdName[editingInvitation.preferredLocale]}.`); router.refresh(); }}
        onReload={() => { setEditingId(null); setNotice("Loading the latest household response. Open it again to review your changes."); router.refresh(); }}
      />}
      <p className="admin-live-notice" role="status">{notice}</p>
    </section>
  );
}
