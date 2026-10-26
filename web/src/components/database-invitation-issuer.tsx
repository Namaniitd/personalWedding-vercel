"use client";

import { coordinatorApiPath } from "@/lib/wedding-side";
import { buildInvitationLinkCsv } from "@/lib/invitation-link-csv";
import { contactNumberSchema } from "@/lib/rsvp";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ContactRole, DatabaseCoordinatorInvitation, DatabaseInvitationIssuerOptions, LocalizedText } from "@/lib/types";
import styles from "./database-invitation-share.module.css";

type DraftEventLimit = {
  selected: boolean;
  adults: string;
  children: string;
};

type IssuedInvitation = Pick<DatabaseCoordinatorInvitation, "id" | "householdName" | "eventCount" | "preferredLocale" | "contactRole" | "createdAt"> & {
  invitationUrl: string;
  contactNumber?: string;
};

type IssuerResponse = {
  ok?: unknown;
  invitationId?: unknown;
  createdAt?: unknown;
  invitationUrl?: unknown;
  householdName?: unknown;
  eventCount?: unknown;
  contactRole?: unknown;
  contactNumber?: unknown;
  error?: unknown;
};

type RevokeResponse = {
  ok?: unknown;
  invitationId?: unknown;
  revokedAt?: unknown;
  error?: unknown;
};

type DeleteRsvpResponse = {
  ok?: unknown;
  invitationId?: unknown;
  rsvpDeletedAt?: unknown;
  error?: unknown;
};

function initialLimits(options: DatabaseInvitationIssuerOptions): Record<string, DraftEventLimit> {
  const defaults = new Map(options.defaultEventLimits.map((limit) => [limit.eventId, limit]));
  return Object.fromEntries(options.events.map((event) => {
    const limit = defaults.get(event.id);
    return [event.id, {
      selected: Boolean(limit),
      adults: String(limit?.adults ?? 2),
      children: String(limit?.children ?? 0)
    }];
  }));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function isIssuedInvitation(value: IssuerResponse): value is {
  ok: true;
  invitationId: string;
  createdAt: string;
  invitationUrl: string;
  householdName: LocalizedText;
  eventCount: number;
  contactRole: ContactRole;
  contactNumber?: string;
} {
  if (value.ok !== true || typeof value.invitationUrl !== "string" || typeof value.eventCount !== "number") return false;
  if (!isUuid(value.invitationId) || !isTimestamp(value.createdAt)) return false;
  if (value.contactRole !== "groom" && value.contactRole !== "bride") return false;
  if (value.contactNumber !== undefined && typeof value.contactNumber !== "string") return false;
  if (!value.householdName || typeof value.householdName !== "object") return false;
  const names = value.householdName as Record<string, unknown>;
  return typeof names.en === "string" && typeof names.hi === "string";
}

function isRevokedInvitation(value: RevokeResponse): value is { ok: true; invitationId: string; revokedAt: string } {
  return value.ok === true && isUuid(value.invitationId) && isTimestamp(value.revokedAt);
}

function isDeletedRsvp(value: DeleteRsvpResponse): value is { ok: true; invitationId: string; rsvpDeletedAt: string } {
  return value.ok === true && isUuid(value.invitationId) && isTimestamp(value.rsvpDeletedAt);
}

function replyToLabel(contactRole: ContactRole) {
  return contactRole === "bride" ? "Bride reply-to" : "Groom reply-to";
}

function shortDate(value: string) {
  return value.slice(0, 10);
}

function numericValue(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function invitationShareMessage(invitation: IssuedInvitation) {
  const householdName = invitation.householdName[invitation.preferredLocale];
  if (invitation.preferredLocale === "hi") {
    return `प्रिय ${householdName}, आप हमारे साथ इस खुशी में शामिल होने के लिए सादर आमंत्रित हैं। अपने कार्यक्रम देखें और निजी निमंत्रण पर जवाब दें।\n\n${invitation.invitationUrl}\n\nकृपया यह लिंक केवल अपने परिवार में साझा करें।`;
  }

  return `Dear ${householdName},\n\nYou are cordially invited to celebrate the joyous occasion of our wedding.\n\nPlease visit your personal invitation to view the event details and RSVP.\n\n💌 ${invitation.invitationUrl}\n\nKindly share this invitation link only with members of your household.\n\nWe look forward to celebrating this special occasion with you!`;
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = value;
    field.readOnly = true;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.focus();
    field.select();
    try {
      return document.execCommand("copy");
    } finally {
      field.remove();
    }
  }
}

export function DatabaseInvitationIssuer({
  options,
  initialInvitations,
  onIssued,
  onBulkIssued,
  onRevoked,
  onRsvpDeleted
}: {
  options: DatabaseInvitationIssuerOptions;
  initialInvitations: DatabaseCoordinatorInvitation[];
  onIssued: (invitation: DatabaseCoordinatorInvitation) => void;
  onBulkIssued: (count: number) => void;
  onRevoked: (invitation: DatabaseCoordinatorInvitation) => void;
  onRsvpDeleted: (invitation: DatabaseCoordinatorInvitation) => void;
}) {
  const [householdNameEn, setHouseholdNameEn] = useState("");
  const [householdNameHi, setHouseholdNameHi] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [bulkIssued, setBulkIssued] = useState<IssuedInvitation[]>([]);
  const [preferredLocale, setPreferredLocale] = useState<"en" | "hi">("en");
  const [contactRole, setContactRole] = useState<ContactRole>(options.defaultContactRole);
  const [limits, setLimits] = useState<Record<string, DraftEventLimit>>(() => initialLimits(options));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [invitations, setInvitations] = useState<DatabaseCoordinatorInvitation[]>(initialInvitations);
  const [linkFilter, setLinkFilter] = useState<"all" | "active" | "revoked">("all");
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [deletingRsvpId, setDeletingRsvpId] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const rawLinkRef = useRef<HTMLInputElement>(null);
  const issuedPanelRef = useRef<HTMLElement>(null);
  const bulkPanelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!issued) return;
    issuedPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    issuedPanelRef.current?.querySelector<HTMLElement>("h3")?.focus();
  }, [issued]);

  useEffect(() => {
    if (!bulkIssued.length) return;
    bulkPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    bulkPanelRef.current?.querySelector<HTMLElement>("h3")?.focus();
  }, [bulkIssued]);

  const selectedCount = useMemo(
    () => Object.values(limits).filter((limit) => limit.selected).length,
    [limits]
  );
  const visibleInvitations = useMemo(
    () => linkFilter === "all" ? invitations : invitations.filter((invitation) => invitation.status === linkFilter),
    [invitations, linkFilter]
  );
  const activeInvitationCount = invitations.filter((invitation) => invitation.status === "active").length;

  function updateLimit(eventId: string, update: Partial<DraftEventLimit>) {
    setLimits((current) => ({
      ...current,
      [eventId]: { ...current[eventId], ...update }
    }));
  }

  function resetDraft() {
    setHouseholdNameEn("");
    setHouseholdNameHi("");
    setContactNumber("");
    setPreferredLocale("en");
    setContactRole(options.defaultContactRole);
    setLimits(initialLimits(options));
  }

  async function copyRawLink() {
    if (!issued) return;
    try {
      if (!await copyText(issued.invitationUrl)) throw new Error("Copy unavailable");
      setCopyStatus("Link copied. Save it privately before closing this panel.");
    } catch {
      const input = rawLinkRef.current;
      if (!input) {
        setCopyStatus("Select and copy the link before closing this panel.");
        return;
      }
      input.focus();
      input.select();
      try {
        const copied = document.execCommand("copy");
        setCopyStatus(copied ? "Link copied. Save it privately before closing this panel." : "Select and copy the link before closing this panel.");
      } catch {
        setCopyStatus("Select and copy the link before closing this panel.");
      }
    }
  }

  async function copyShareMessage() {
    if (!issued) return;
    try {
      if (!await copyText(invitationShareMessage(issued))) throw new Error("Copy unavailable");
      setCopyStatus("Invitation message copied. Paste it into a private conversation for this household.");
    } catch {
      setCopyStatus("Copy is unavailable here. Select the link above and send it in a private conversation.");
    }
  }

  async function shareInvitation() {
    if (!issued) return;
    if (!navigator.share) {
      await copyShareMessage();
      return;
    }
    try {
      await navigator.share({
        title: "Private wedding invitation",
        text: invitationShareMessage(issued)
      });
      setCopyStatus("Share sheet closed. Check that you sent this only to the intended household.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setCopyStatus("Sharing is unavailable here. Copy the message and send it privately instead.");
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setCopyStatus("");
    setActionNotice("");

    if (issued || bulkIssued.length) {
      setError("Share or save the current one-time link before creating another invitation.");
      return;
    }

    const eventLimits = options.events.flatMap((eventOption) => {
      const limit = limits[eventOption.id];
      if (!limit?.selected) return [];
      const adults = numericValue(limit.adults);
      const children = numericValue(limit.children);
      if (adults === null || children === null) return [];
      return [{ eventId: eventOption.id, adults, children }];
    });
    const hasInvalidLimit = options.events.some((eventOption) => {
      const limit = limits[eventOption.id];
      return limit?.selected && (numericValue(limit.adults) === null || numericValue(limit.children) === null);
    });

    if (!householdNameEn.trim() && !householdNameHi.trim()) {
      setError("Enter an English or Hindi household name.");
      return;
    }
    if (!contactNumberSchema.safeParse(contactNumber).success) {
      setError("Enter a contact number with 7 to 15 digits, or leave it blank.");
      return;
    }
    if (selectedCount === 0) {
      setError("Choose at least one celebration for this invitation.");
      return;
    }
    if (hasInvalidLimit || eventLimits.some((limit) => limit.adults + limit.children === 0)) {
      setError("Each selected celebration needs a whole-number guest limit with room for at least one guest.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(coordinatorApiPath("invitations"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ householdNameEn, householdNameHi, preferredLocale, contactRole, contactNumber, eventLimits })
      });
      const body = await response.json().catch(() => ({})) as IssuerResponse;
      if (!response.ok || !isIssuedInvitation(body)) {
        setError(typeof body.error === "string" ? body.error : "We could not create this invitation.");
        return;
      }

      const nextIssued = {
        id: body.invitationId,
        createdAt: body.createdAt,
        invitationUrl: body.invitationUrl,
        householdName: body.householdName,
        eventCount: body.eventCount,
        preferredLocale,
        contactNumber: body.contactNumber,
        contactRole: body.contactRole
      };
      setIssued(nextIssued);
      const databaseInvitation: DatabaseCoordinatorInvitation = {
        id: nextIssued.id,
        householdName: nextIssued.householdName,
        preferredLocale: nextIssued.preferredLocale,
        contactRole: nextIssued.contactRole,
        contactNumber: nextIssued.contactNumber,
        status: "active",
        revokedAt: null,
        rsvpDeletedAt: null,
        entryPass: null,
        eventCount: nextIssued.eventCount,
        eventLimits,
        createdAt: nextIssued.createdAt,
        rsvp: null
      };
      setInvitations((current) => [databaseInvitation, ...current]);
      onIssued(databaseInvitation);
      resetDraft();
    } catch {
      setError("We could not create this invitation.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function createBulkInvitations() {
    setError(""); setCopyStatus(""); setActionNotice("");
    if (issued || bulkIssued.length) { setError("Save the current one-time links before creating more invitations."); return; }
    if (!csvFile) { setError("Choose a CSV file with name and contactnumber columns."); return; }
    if (csvFile.size > 256 * 1024) { setError("Choose a CSV file smaller than 256 KB, containing at most 200 contacts."); return; }
    const eventLimits = options.events.flatMap((eventOption) => {
      const limit = limits[eventOption.id];
      if (!limit?.selected) return [];
      const adults = numericValue(limit.adults); const children = numericValue(limit.children);
      return adults === null || children === null ? [] : [{ eventId: eventOption.id, adults, children }];
    });
    if (!selectedCount || eventLimits.length !== selectedCount || eventLimits.some((limit) => limit.adults + limit.children === 0)) {
      setError("Choose celebrations and whole-number guest limits with room for at least one guest."); return;
    }
    setIsSubmitting(true);
    try {
      const csv = await csvFile.text();
      const response = await fetch(coordinatorApiPath("invitations/bulk"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv, eventLimits, preferredLocale, contactRole }) });
      const body: { ok?: unknown; invitations?: unknown; error?: unknown } = await response.json().catch(() => ({}));
      if (!response.ok || body.ok !== true || !Array.isArray(body.invitations) || !body.invitations.length || !body.invitations.every((entry: IssuerResponse) => isIssuedInvitation({ ...entry, ok: true }))) {
        setError(typeof body.error === "string" ? body.error : "We could not create these invitations."); return;
      }
      const issuedRows: IssuedInvitation[] = body.invitations.map((entry: IssuerResponse) => {
        const value = { ...entry, ok: true };
        if (!isIssuedInvitation(value)) throw new Error("Invalid invitation result");
        return { id: value.invitationId, createdAt: value.createdAt, invitationUrl: value.invitationUrl, householdName: value.householdName, eventCount: value.eventCount, preferredLocale, contactRole: value.contactRole, contactNumber: value.contactNumber };
      });
      const records: DatabaseCoordinatorInvitation[] = issuedRows.map((entry) => ({ id: entry.id, createdAt: entry.createdAt, householdName: entry.householdName, preferredLocale: entry.preferredLocale, contactRole: entry.contactRole, contactNumber: entry.contactNumber, eventCount: entry.eventCount, status: "active", revokedAt: null, rsvpDeletedAt: null, entryPass: null, eventLimits, rsvp: null }));
      setBulkIssued(issuedRows); setInvitations((current) => [...records, ...current]); onBulkIssued(records.length);
    } catch { setError("We could not create these invitations. Check the invitation list before retrying if your connection was interrupted."); }
    finally { setIsSubmitting(false); }
  }

  function downloadBulkLinks() {
    const url = URL.createObjectURL(new Blob(["\uFEFF", buildInvitationLinkCsv(bulkIssued)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "private-invitation-links.csv";
    document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setCopyStatus("CSV downloaded. Keep it private: it contains each household’s invitation link.");
  }

  async function revokeInvitation(invitation: DatabaseCoordinatorInvitation) {
    if (invitation.status !== "active" || revokingId || deletingRsvpId) return;
    const household = invitation.householdName[invitation.preferredLocale];
    if (!window.confirm(`Delete and revoke the private link for ${household}? It will stop working immediately and cannot be re-enabled.`)) return;

    setError("");
    setActionNotice("");
    setRevokingId(invitation.id);
    try {
      const response = await fetch(coordinatorApiPath("invitations/revoke"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitationId: invitation.id })
      });
      const body = await response.json().catch(() => ({})) as RevokeResponse;
      if (!response.ok || !isRevokedInvitation(body) || body.invitationId !== invitation.id) {
        const responseError = "error" in body && typeof body.error === "string" ? body.error : null;
        setError(responseError ?? "We could not revoke this invitation link.");
        return;
      }

      const revokedInvitation: DatabaseCoordinatorInvitation = {
        ...invitation,
        status: "revoked",
        revokedAt: body.revokedAt
      };
      setInvitations((current) => current.map((entry) => entry.id === invitation.id ? revokedInvitation : entry));
      setBulkIssued((current) => current.filter((entry) => entry.id !== invitation.id));
      setCopyStatus("");
      if (issued?.id === invitation.id) {
        setIssued(null);
      }
      onRevoked(revokedInvitation);
    } catch {
      setError("We could not revoke this invitation link.");
    } finally {
      setRevokingId(null);
    }
  }

  async function deleteRsvp(invitation: DatabaseCoordinatorInvitation) {
    if (invitation.status !== "revoked" || !invitation.rsvp || deletingRsvpId || revokingId) return;
    const household = invitation.householdName[invitation.preferredLocale];
    const confirmed = window.confirm(
      `Permanently delete the RSVP for ${household}? The invitation will stay revoked, but the guest response, guest counts, and notes cannot be recovered.`
    );
    if (!confirmed) return;

    setError("");
    setActionNotice("");
    setDeletingRsvpId(invitation.id);
    try {
      const response = await fetch(coordinatorApiPath("invitations/rsvp/delete"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitationId: invitation.id })
      });
      const body = await response.json().catch(() => ({})) as DeleteRsvpResponse;
      if (!response.ok || !isDeletedRsvp(body) || body.invitationId !== invitation.id) {
        const responseError = "error" in body && typeof body.error === "string" ? body.error : null;
        setError(responseError ?? "We could not delete this RSVP.");
        return;
      }

      const clearedInvitation: DatabaseCoordinatorInvitation = {
        ...invitation,
        rsvp: null,
        rsvpDeletedAt: body.rsvpDeletedAt
      };
      setInvitations((current) => current.map((entry) => entry.id === invitation.id ? clearedInvitation : entry));
      setActionNotice(`The RSVP for ${household} was permanently deleted. The revoked invitation audit remains.`);
      onRsvpDeleted(clearedInvitation);
    } catch {
      setError("We could not delete this RSVP.");
    } finally {
      setDeletingRsvpId(null);
    }
  }

  return (
    <section className="database-invitation-issuer" id="invitation-links" aria-labelledby="invitation-links-title">
      <div className="database-invitation-issuer-heading">
        <div>
          <p>Coordinator workspace</p>
          <h2 id="invitation-links-title">Create a private invitation link</h2>
          <span>Choose a household name and its celebrations, then share the private link with your guests.</span>
        </div>
        <div className="database-invitation-safety-note"><span aria-hidden="true">⌁</span><p>Raw links are shown once. They are not kept in the invitation list or browser storage.</p></div>
      </div>

      <form className="database-invitation-form" onSubmit={submit} autoComplete="off">
        <div className="database-invitation-name-grid">
          <label htmlFor="database-invitation-name-en">Household or friend name <span>English</span>
            <input id="database-invitation-name-en" value={householdNameEn} onChange={(event) => setHouseholdNameEn(event.target.value)} maxLength={100} placeholder="Enter household name" />
          </label>
          <label htmlFor="database-invitation-name-hi">Household or friend name <span>Hindi · optional</span>
            <input id="database-invitation-name-hi" value={householdNameHi} onChange={(event) => setHouseholdNameHi(event.target.value)} maxLength={100} placeholder="परिवार का नाम लिखें" lang="hi" />
          </label>
        </div>
        <p className="database-invitation-fallback">Provide either name; the supplied version becomes the fallback when a guest switches language.</p>
        <label className={styles.contactField} htmlFor="database-invitation-number">Guest contact number <span>Optional</span>
          <input id="database-invitation-number" type="tel" inputMode="tel" maxLength={40} value={contactNumber} onChange={(event) => setContactNumber(event.target.value)} placeholder="Include country code" />
          <small>Prefilled on the guest’s RSVP. This is separate from the reply-to contact below.</small>
        </label>

        <div className="database-invitation-locale">
          <span>Open this invitation in</span>
          <label><input type="radio" name="database-invitation-locale" checked={preferredLocale === "en"} onChange={() => setPreferredLocale("en")} /> English</label>
          <label><input type="radio" name="database-invitation-locale" checked={preferredLocale === "hi"} onChange={() => setPreferredLocale("hi")} /> हिन्दी</label>
        </div>

        <fieldset className="database-invitation-contact">
          <legend>Reply-to contact <small>The selected person’s name and number appear on this invitation.</small></legend>
          <div className="database-invitation-contact-options">
            {options.contactOptions.map((contact) => (
              <label className={contactRole === contact.role ? "is-selected" : ""} key={contact.role} htmlFor={`database-invitation-contact-${contact.role}`}>
                <input
                  id={`database-invitation-contact-${contact.role}`}
                  type="radio"
                  name="database-invitation-contact"
                  value={contact.role}
                  checked={contactRole === contact.role}
                  onChange={() => setContactRole(contact.role)}
                />
                <span><strong>{contact.role === "groom" ? "Groom" : "Bride"} · {contact.name}</strong><small>{contact.phoneDisplay}</small></span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="database-invitation-events">
          <legend>Invited celebrations <small>Set a guest cap for each selected celebration.</small></legend>
          <div className="database-invitation-event-list">
            {options.events.map((eventOption) => {
              const limit = limits[eventOption.id] ?? { selected: false, adults: "2", children: "0" };
              return <div className={`database-invitation-event${limit.selected ? " is-selected" : ""}`} key={eventOption.id}>
                <label className="database-invitation-event-toggle" htmlFor={`database-invitation-event-${eventOption.id}`}>
                  <input
                    id={`database-invitation-event-${eventOption.id}`}
                    type="checkbox"
                    checked={limit.selected}
                    onChange={(event) => updateLimit(eventOption.id, { selected: event.target.checked })}
                  />
                  <span><strong>{eventOption.title.en}</strong><small lang="hi">{eventOption.title.hi}</small></span>
                </label>
                <div className="database-invitation-limit-inputs" aria-label={`Guest limit for ${eventOption.title.en}`}>
                  <label htmlFor={`database-invitation-adults-${eventOption.id}`}>Adults
                    <input
                      id={`database-invitation-adults-${eventOption.id}`}
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="30"
                      value={limit.adults}
                      disabled={!limit.selected}
                      onChange={(event) => updateLimit(eventOption.id, { adults: event.target.value })}
                    />
                  </label>
                  <label htmlFor={`database-invitation-children-${eventOption.id}`}>Children
                    <input
                      id={`database-invitation-children-${eventOption.id}`}
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="30"
                      value={limit.children}
                      disabled={!limit.selected}
                      onChange={(event) => updateLimit(eventOption.id, { children: event.target.value })}
                    />
                  </label>
                </div>
              </div>;
            })}
          </div>
        </fieldset>

        {error && <p className="database-invitation-error" role="alert">{error}</p>}
        <div className="database-invitation-submit-row">
          <span>{selectedCount} celebration{selectedCount === 1 ? "" : "s"} selected</span>
          <button type="submit" className="admin-primary-button" disabled={isSubmitting || issued !== null || bulkIssued.length > 0}>{issued || bulkIssued.length ? "Save current links first" : isSubmitting ? "Creating…" : "Create one-time link"}</button>
        </div>

        <section className={styles.bulkUpload} aria-labelledby="bulk-invitations-title">
          <h3 id="bulk-invitations-title">Create private links from a CSV</h3>
          <p>Upload up to 200 contacts with columns <code>name,contactnumber</code>. Every contact receives the celebrations, guest limits, language, and reply-to contact selected above. A household name above is not needed.</p>
          <label htmlFor="database-invitation-csv">Contact CSV<input id="database-invitation-csv" type="file" accept=".csv,text/csv" disabled={isSubmitting} onChange={(event) => setCsvFile(event.target.files?.[0] ?? null)} /></label>
          <small>Use a spreadsheet’s CSV export. Keep contact numbers as text, including country codes.</small>
          <button type="button" className="admin-primary-button" disabled={isSubmitting || issued !== null || bulkIssued.length > 0 || !csvFile} onClick={createBulkInvitations}>{isSubmitting ? "Creating…" : "Create private links from CSV"}</button>
        </section>
      </form>

      {bulkIssued.length > 0 && <aside ref={bulkPanelRef} className="database-invitation-link-panel" aria-live="polite" aria-labelledby="bulk-links-title">
        <div><p>{bulkIssued.length} private links created</p><h3 id="bulk-links-title" tabIndex={-1}>Save these links now — they cannot be shown again.</h3></div>
        <div className={styles.actions}><button type="button" className={styles.shareButton} onClick={downloadBulkLinks}>Download links CSV</button><button type="button" className={styles.copyButton} onClick={async () => {
          try { if (!await copyText(buildInvitationLinkCsv(bulkIssued))) throw new Error("Copy unavailable"); setCopyStatus("All invitation links copied as CSV. Save them privately."); }
          catch { setCopyStatus("Copy is unavailable. Download the CSV or select each link below."); }
        }}>Copy all as CSV</button></div>
        <ul className={styles.bulkLinks}>{bulkIssued.map((invitation) => <li key={invitation.id}><label><strong>{invitation.householdName[invitation.preferredLocale]}</strong><small>{invitation.contactNumber}</small><input readOnly value={invitation.invitationUrl} onFocus={(event) => event.target.select()} aria-label={`Private link for ${invitation.householdName[invitation.preferredLocale]}`} /></label><button type="button" className={styles.copyButton} onClick={async () => { try { if (!await copyText(invitation.invitationUrl)) throw new Error("Copy unavailable"); setCopyStatus(`Link copied for ${invitation.householdName[invitation.preferredLocale]}.`); } catch { setCopyStatus("Select and copy the link beside this button."); } }}>Copy link</button></li>)}</ul>
        <p className="database-invitation-link-warning">This CSV contains private invitation links and contact numbers. Store it privately. Closing this panel or reloading removes the raw links from this app.</p>
        {copyStatus && <p role="status">{copyStatus}</p>}
        <button type="button" className="database-invitation-dismiss-link" onClick={() => { setBulkIssued([]); setCopyStatus(""); }}>I saved the links — hide them</button>
      </aside>}

      {issued && <aside ref={issuedPanelRef} className="database-invitation-link-panel" aria-live="polite" aria-labelledby="database-invitation-link-title">
        <div>
          <p>Link created for {issued.householdName[issued.preferredLocale]} · Reply-to: {options.contactOptions.find((contact) => contact.role === issued.contactRole)?.name ?? issued.contactRole}</p>
          <h3 id="database-invitation-link-title" tabIndex={-1}>Share it now — it cannot be shown again.</h3>
        </div>
        <label htmlFor="database-issued-link" className="sr-only">New private invitation link</label>
        <div className="database-invitation-copy-row">
          <input ref={rawLinkRef} id="database-issued-link" value={issued.invitationUrl} readOnly autoComplete="off" onFocus={(event) => event.target.select()} />
          <button type="button" className="admin-primary-button" onClick={copyRawLink}>Copy link</button>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.shareButton} onClick={shareInvitation}>Share privately</button>
          <button type="button" className={styles.copyButton} onClick={copyShareMessage}>Copy invitation message</button>
        </div>
        <p className="database-invitation-link-warning">Send it privately. Closing this panel or reloading the coordinator page permanently removes the raw URL from this app.</p>
        {copyStatus && <p className="database-invitation-copy-status" role="status">{copyStatus}</p>}
        <button type="button" className="database-invitation-dismiss-link" onClick={() => { setIssued(null); setCopyStatus(""); }}>I shared or saved it — hide link</button>
      </aside>}

      {actionNotice && <p className="database-invitation-action-notice" role="status">{actionNotice}</p>}

      <section className="database-invitation-list" aria-labelledby="issued-invitations-title">
        <div className="database-invitation-list-heading">
          <div>
            <p>Invitation records</p>
            <h3 id="issued-invitations-title">Issued private links</h3>
            <span>{activeInvitationCount} active · {invitations.length - activeInvitationCount} revoked</span>
          </div>
          <div className="database-invitation-status-filter" role="group" aria-label="Filter invitation links by status">
            {(["all", "active", "revoked"] as const).map((status) => <button
              key={status}
              type="button"
              className={linkFilter === status ? "is-active" : ""}
              aria-pressed={linkFilter === status}
              onClick={() => setLinkFilter(status)}
            >{status === "all" ? "All" : status === "active" ? "Active" : "Revoked"}</button>)}
          </div>
        </div>
        <ul className="database-invitation-list-items">
          {visibleInvitations.map((invitation) => {
            const household = invitation.householdName[invitation.preferredLocale];
            const isActive = invitation.status === "active";
            return (
              <li className={isActive ? "is-active" : "is-revoked"} key={invitation.id}>
                <div>
                  <strong>{household}</strong>
                  {(invitation.rsvp ? invitation.rsvp.contactNumber : invitation.contactNumber) && <small>Guest contact: {invitation.rsvp ? invitation.rsvp.contactNumber : invitation.contactNumber}</small>}
                  <small>{replyToLabel(invitation.contactRole)} · issued {shortDate(invitation.createdAt)}</small>
                  {!isActive && invitation.revokedAt && <small>Revoked {shortDate(invitation.revokedAt)}</small>}
                  {!isActive && invitation.rsvp && <small className="database-invitation-rsvp-on-file">RSVP on file · delete it below if it should be erased</small>}
                  {!isActive && invitation.rsvpDeletedAt && <small>RSVP deleted {shortDate(invitation.rsvpDeletedAt)}</small>}
                </div>
                <div className="database-invitation-record-actions">
                  <span className={`database-invitation-status database-invitation-status-${invitation.status}`}>{isActive ? "Active" : "Revoked"}</span>
                  {isActive && <button
                    type="button"
                    className="database-invitation-revoke"
                    disabled={revokingId !== null || deletingRsvpId !== null}
                    onClick={() => revokeInvitation(invitation)}
                  >{revokingId === invitation.id ? "Revoking…" : "Delete & revoke link"}</button>}
                  {!isActive && invitation.rsvp && <button
                    type="button"
                    className="database-invitation-delete-rsvp"
                    disabled={revokingId !== null || deletingRsvpId !== null}
                    onClick={() => deleteRsvp(invitation)}
                  >{deletingRsvpId === invitation.id ? "Deleting RSVP…" : "Delete RSVP"}</button>}
                </div>
              </li>
            );
          })}
          {visibleInvitations.length === 0 && <li className="database-invitation-list-empty">
            <strong>{invitations.length === 0 ? "No invitations yet." : "No invitation links match this filter."}</strong>
            <span>{invitations.length === 0 ? "Create a private link above. Raw URLs are never retained here." : "Choose another status to review invitation records."}</span>
          </li>}
        </ul>
      </section>
    </section>
  );
}
