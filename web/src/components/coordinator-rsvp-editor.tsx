"use client";

import { coordinatorApiPath } from "@/lib/wedding-side";

import { useEffect, useId, useRef, useState } from "react";

import { coordinatorRsvpDraft, coordinatorRsvpValidation, type CoordinatorRsvpInput } from "@/lib/coordinator-rsvp";
import type { AttendanceInput, DatabaseCoordinatorInvitation, DatabaseInvitationEventOption, RSVPStatus } from "@/lib/types";

import styles from "./coordinator-rsvp-editor.module.css";

export function CoordinatorRSVPEditor({ invitation, events, onSaved, onCancel, onReload, onSavingChange }: {
  invitation: DatabaseCoordinatorInvitation;
  events: DatabaseInvitationEventOption[];
  onSaved: () => void;
  onCancel: () => void;
  onReload: () => void;
  onSavingChange: (isSaving: boolean) => void;
}) {
  const [draft, setDraft] = useState<CoordinatorRsvpInput>(() => coordinatorRsvpDraft(invitation));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const household = invitation.householdName[invitation.preferredLocale];

  useEffect(() => {
    headingRef.current?.focus();
    headingRef.current?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, []);

  function setStatus(status: RSVPStatus) {
    setError("");
    setDraft((current) => ({ ...current, status,
      comfortNote: status === "attending" ? current.comfortNote : "",
      declineMessage: status === "declined" ? current.declineMessage : "",
      attendances: status === "attending" ? current.attendances : current.attendances.map((attendance) => ({ ...attendance, attending: false, adults: 0, children: 0 }))
    }));
  }

  function updateAttendance(eventId: string, update: Partial<AttendanceInput>) {
    setError("");
    setDraft((current) => ({ ...current, attendances: current.attendances.map((attendance) => {
      if (attendance.eventId !== eventId) return attendance;
      const next = { ...attendance, ...update };
      if (update.attending === false) return { ...next, adults: 0, children: 0 };
      if (update.attending === true && next.adults + next.children === 0) {
        const limit = invitation.eventLimits.find((candidate) => candidate.eventId === eventId);
        return { ...next, adults: limit?.adults ? 1 : 0, children: !limit?.adults && limit?.children ? 1 : 0 };
      }
      return next;
    }) }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    const input = { ...draft, respondentName: draft.respondentName.trim(),
      comfortNote: draft.status === "attending" ? draft.comfortNote?.trim() || undefined : undefined,
      declineMessage: draft.status === "declined" ? draft.declineMessage?.trim() || undefined : undefined
    };
    const validation = coordinatorRsvpValidation(input, invitation);
    if (validation) { setError(validation); return; }
    setIsSaving(true);
    onSavingChange(true);
    setError("");
    setConflict(false);
    try {
      const response = await fetch(coordinatorApiPath("rsvp"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setConflict(response.status === 409);
        const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error.slice(0, 360) : "We could not save this reply. Please try again.";
        setError(message);
        return;
      }
      if (!body || typeof body !== "object" || !("ok" in body) || body.ok !== true || !("updatedAt" in body) || typeof body.updatedAt !== "string") {
        setError("The reply could not be confirmed. Reload the current response before trying again.");
        setConflict(true);
        return;
      }
      onSaved();
    } catch {
      setError("We could not reach the RSVP service. Your changes are still here; try again.");
    } finally {
      setIsSaving(false);
      onSavingChange(false);
    }
  }

  return <section className={styles.editor} aria-labelledby={`${id}-title`}>
    <p className={styles.kicker}>Phone or WhatsApp reply</p>
    <h2 id={`${id}-title`} tabIndex={-1} ref={headingRef}>{invitation.rsvp ? "Review and update" : "Record a reply for"} {household}</h2>
    <p>Record what the household told you. You can update active, unexpired invitations after online RSVPs close.</p>
    <form onSubmit={save}>
      <fieldset disabled={isSaving} className={styles.fields}>
        <legend className="sr-only">Household reply</legend>
        <div className={styles.grid}>
          <label>Respondent’s name<input value={draft.respondentName} onChange={(event) => setDraft((current) => ({ ...current, respondentName: event.target.value }))} minLength={2} maxLength={100} required autoComplete="off" /></label>
          <label>Contact number (optional)<input type="tel" inputMode="tel" value={draft.contactNumber ?? ""} onChange={(event) => setDraft((current) => ({ ...current, contactNumber: event.target.value }))} maxLength={40} autoComplete="off" /></label>
          <label>Household’s plan<select value={draft.status} onChange={(event) => setStatus(event.target.value as RSVPStatus)}>
            <option value="attending">Plans to attend</option><option value="declined">Unable to attend</option><option value="confirming">Will confirm soon</option>
          </select></label>
        </div>
        {draft.status === "attending" && <div className={styles.events}>{invitation.eventLimits.map((limit) => {
          const attendance = draft.attendances.find((candidate) => candidate.eventId === limit.eventId);
          if (!attendance) return null;
          const title = events.find((event) => event.id === limit.eventId)?.title.en ?? "Unavailable celebration";
          return <fieldset key={limit.eventId} className={styles.event}>
            <legend>{title}</legend>
            <label>Attendance<select value={attendance.attending ? "yes" : "no"} onChange={(event) => updateAttendance(limit.eventId, { attending: event.target.value === "yes" })}>
              <option value="no">Will not attend</option><option value="yes">Will attend</option>
            </select></label>
            {attendance.attending && <div className={styles.counts}>
              <label>Adults (up to {limit.adults})<input type="number" min={0} max={limit.adults} step={1} required value={Number.isFinite(attendance.adults) ? attendance.adults : ""} onChange={(event) => updateAttendance(limit.eventId, { adults: event.target.valueAsNumber })} /></label>
              <label>Children (up to {limit.children})<input type="number" min={0} max={limit.children} step={1} required value={Number.isFinite(attendance.children) ? attendance.children : ""} onChange={(event) => updateAttendance(limit.eventId, { children: event.target.valueAsNumber })} /></label>
            </div>}
          </fieldset>;
        })}</div>}
        {draft.status === "attending" && <label>Hospitality requests (optional)<textarea rows={3} maxLength={500} value={draft.comfortNote ?? ""} onChange={(event) => setDraft((current) => ({ ...current, comfortNote: event.target.value }))} /><small>Dietary, accessibility, or practical assistance; include only what the team needs.</small></label>}
        {draft.status === "declined" && <label>Message for the couple (optional)<textarea rows={3} maxLength={500} value={draft.declineMessage ?? ""} onChange={(event) => setDraft((current) => ({ ...current, declineMessage: event.target.value }))} /></label>}
        <div className={styles.actions}><button type="submit" className="admin-primary-button">{isSaving ? "Saving reply…" : "Save reply"}</button><button type="button" className="admin-outline-button" onClick={onCancel}>Cancel</button></div>
      </fieldset>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {conflict && <button type="button" className="admin-outline-button" disabled={isSaving} onClick={onReload}>Reload current response</button>}
    </form>
  </section>;
}
