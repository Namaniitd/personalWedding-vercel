"use client";

import { type FormEvent, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type {
  ContactRole,
  DatabaseWeddingContentContact,
  DatabaseWeddingContentEvent,
  DatabaseWeddingContentSettings,
  DatabaseWeddingContentSnapshot
} from "@/lib/types";

import styles from "./coordinator-content-editor.module.css";

type ContentSection = "settings" | "events" | "contacts";
type EventCategory = DatabaseWeddingContentEvent["category"];

/**
 * The coordinator-only snapshot intentionally excludes connection details,
 * invitation tokens, and other runtime secrets. It is shared as plain data so
 * the form can save all related content in one reviewed change.
 */
export type CoordinatorContentSettings = DatabaseWeddingContentSettings;
export type CoordinatorContentContact = DatabaseWeddingContentContact;
export type CoordinatorContentEvent = DatabaseWeddingContentEvent;
export type CoordinatorContentSnapshot = DatabaseWeddingContentSnapshot;

type SaveResponse = {
  ok?: unknown;
  error?: unknown;
  revision?: unknown;
  configuration?: unknown;
  content?: unknown;
};

const MAX_GUEST_CONTENT_CHARS = 48_000;

const sectionCopy: Array<{ id: ContentSection; label: string; description: string }> = [
  { id: "settings", label: "Wedding details", description: "Names, timing, RSVP window and invitation notice" },
  { id: "events", label: "Events", description: "Schedule, venue, visibility and new-invite defaults" },
  { id: "contacts", label: "Reply-to contacts", description: "Phone contacts displayed on private invitations" }
];

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function textValue(value: string | null | undefined) {
  return value ?? "";
}

function normalizeSnapshot(value: CoordinatorContentSnapshot): CoordinatorContentSnapshot {
  return {
    revision: typeof value.revision === "string" ? value.revision : null,
    settings: {
      ...value.settings,
      announcementEn: textValue(value.settings.announcementEn),
      announcementHi: textValue(value.settings.announcementHi),
      announcementStartsAt: value.settings.announcementStartsAt ?? null,
      announcementEndsAt: value.settings.announcementEndsAt ?? null,
      guestContent: value.settings.guestContent ?? null
    },
    contacts: value.contacts.map((contact) => ({ ...contact })),
    events: value.events.map((event) => ({ ...event }))
  };
}

function serialize(value: unknown) {
  return JSON.stringify(value);
}

function guestContentText(value: unknown | null) {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

/** Render and edit timestamps in the wedding's timezone, not the browser's. */
function indiaDateTimeInputValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}T${lookup.hour}:${lookup.minute}:${lookup.second}`;
}

function indiaInputToIso(value: string) {
  if (!value) return "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return "";
  const wallClock = value.length === 16 ? `${value}:00` : value;
  const candidate = new Date(`${wallClock}+05:30`);
  return Number.isFinite(candidate.getTime()) ? candidate.toISOString() : "";
}

function eventIdFrom(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 88);
  return normalized || "event";
}

function nextEventId(events: CoordinatorContentEvent[]) {
  const used = new Set(events.map((event) => event.id));
  const stem = "event";
  let number = events.length + 1;
  while (used.has(`${stem}-${number}`)) number += 1;
  return `${stem}-${number}`;
}

function blankEvent(events: CoordinatorContentEvent[]): CoordinatorContentEvent {
  const id = nextEventId(events);
  const nextOrder = events.reduce((largest, event) => Math.max(largest, event.displayOrder), 0) + 1;
  return {
    id,
    slug: id,
    titleEn: "",
    titleHi: "",
    dateEn: "",
    dateHi: "",
    startTimeEn: "",
    startTimeHi: "",
    arrivalWindowEn: "",
    arrivalWindowHi: "",
    startAt: "",
    endAt: "",
    venueEn: "",
    venueHi: "",
    addressEn: "",
    addressHi: "",
    mapsUrl: "",
    entryNoteEn: "",
    entryNoteHi: "",
    dressCodeEn: "",
    dressCodeHi: "",
    practicalNoteEn: "",
    practicalNoteHi: "",
    category: "celebration",
    published: false,
    displayOrder: nextOrder,
    defaultSelected: false,
    defaultAdultLimit: 2,
    defaultChildLimit: 0
  };
}

function safeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validIndianMobile(value: string) {
  const compact = value.trim().replace(/[\s().-]/g, "");
  const digits = compact.startsWith("+") ? compact.slice(1) : compact;
  const withCountryCode = digits.length === 10 ? `91${digits}` : digits;
  return /^91[6-9]\d{9}$/.test(withCountryCode);
}

function fieldIsBlank(value: string) {
  return value.trim().length === 0;
}

function parseGuestContent(value: string): { value: unknown | null } | { error: string } {
  const content = value.trim();
  if (!content) return { value: null };
  if (content.length > MAX_GUEST_CONTENT_CHARS) {
    return { error: "The advanced invitation content is too long to save." };
  }
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "Advanced invitation content must be one JSON object, or left blank." };
    }
    return { value: parsed };
  } catch {
    return { error: "Advanced invitation content is not valid JSON. Fix it or use Format JSON." };
  }
}

function validateSnapshot(snapshot: CoordinatorContentSnapshot): string | null {
  const { settings } = snapshot;
  const requiredSettings: Array<[string, string]> = [
    ["Couple names (English)", settings.coupleNamesEn],
    ["Couple names (Hindi)", settings.coupleNamesHi],
    ["Displayed date (English)", settings.weddingDateEn],
    ["Displayed date (Hindi)", settings.weddingDateHi],
    ["Location (English)", settings.locationEn],
    ["Location (Hindi)", settings.locationHi],
    ["Wedding moment", settings.weddingMoment],
    ["RSVP deadline", settings.rsvpDeadline],
    ["Last-edit cutoff", settings.canEditUntil],
    ["Coordinator fallback name", settings.coordinatorName],
    ["Coordinator fallback phone", settings.coordinatorPhone]
  ];
  const missingSetting = requiredSettings.find(([, value]) => fieldIsBlank(value));
  if (missingSetting) return `${missingSetting[0]} is required.`;
  if (!validIndianMobile(settings.coordinatorPhone)) {
    return "The coordinator fallback needs a valid Indian mobile number.";
  }

  const rsvpDeadline = new Date(settings.rsvpDeadline);
  const editDeadline = new Date(settings.canEditUntil);
  if (!Number.isFinite(rsvpDeadline.getTime()) || !Number.isFinite(editDeadline.getTime())) {
    return "Use valid dates and times for the RSVP window.";
  }
  if (editDeadline > rsvpDeadline) {
    return "The last-edit cutoff cannot be after the displayed RSVP deadline.";
  }

  const hasAnnouncement = Boolean(settings.announcementEn?.trim() || settings.announcementHi?.trim());
  if (hasAnnouncement && (!settings.announcementEn?.trim() || !settings.announcementHi?.trim())) {
    return "Write the invitation notice in both English and Hindi, or clear both fields to turn it off.";
  }
  const announcementStarts = settings.announcementStartsAt ? new Date(settings.announcementStartsAt) : null;
  const announcementEnds = settings.announcementEndsAt ? new Date(settings.announcementEndsAt) : null;
  if ((announcementStarts && !Number.isFinite(announcementStarts.getTime())) || (announcementEnds && !Number.isFinite(announcementEnds.getTime()))) {
    return "Use valid dates and times for the invitation notice.";
  }
  if ((announcementStarts && !announcementEnds) || (!announcementStarts && announcementEnds)) {
    return "Set both start and end times for a scheduled invitation notice, or leave both blank.";
  }
  if (announcementStarts && announcementEnds && announcementEnds <= announcementStarts) {
    return "The invitation notice must end after it starts.";
  }

  for (const contact of snapshot.contacts) {
    if (contact.role !== "groom" && contact.role !== "bride") return "A reply-to contact has an unsupported role.";
    if (fieldIsBlank(contact.name) || fieldIsBlank(contact.phone)) {
      return `The ${contact.role} reply-to contact needs a name and Indian mobile number.`;
    }
    if (!validIndianMobile(contact.phone)) return `The ${contact.role} reply-to contact needs a valid Indian mobile number.`;
  }

  if (snapshot.events.length === 0) return "Keep at least one event in the schedule.";
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const event of snapshot.events) {
    if (!/^[a-z0-9-]{1,100}$/.test(event.id)) return "Each event ID must use lowercase letters, numbers, and hyphens.";
    if (!/^[a-z0-9-]{1,100}$/.test(event.slug)) return `The URL label for ${event.id} must use lowercase letters, numbers, and hyphens.`;
    if (ids.has(event.id)) return `The event ID “${event.id}” is duplicated.`;
    if (slugs.has(event.slug)) return `The URL label “${event.slug}” is duplicated.`;
    ids.add(event.id);
    slugs.add(event.slug);

    const requiredEventFields: Array<[string, string]> = [
      ["English title", event.titleEn], ["Hindi title", event.titleHi],
      ["English date", event.dateEn], ["Hindi date", event.dateHi],
      ["English start time", event.startTimeEn], ["Hindi start time", event.startTimeHi],
      ["English arrival window", event.arrivalWindowEn], ["Hindi arrival window", event.arrivalWindowHi],
      ["Start time", event.startAt], ["End time", event.endAt],
      ["English venue", event.venueEn], ["Hindi venue", event.venueHi],
      ["English address", event.addressEn], ["Hindi address", event.addressHi],
      ["Maps link", event.mapsUrl], ["English entry note", event.entryNoteEn], ["Hindi entry note", event.entryNoteHi],
      ["English dress code", event.dressCodeEn], ["Hindi dress code", event.dressCodeHi],
      ["English practical note", event.practicalNoteEn], ["Hindi practical note", event.practicalNoteHi]
    ];
    const missing = requiredEventFields.find(([, value]) => fieldIsBlank(value));
    if (missing) return `${missing[0]} is required for ${event.id}.`;
    const start = new Date(event.startAt);
    const end = new Date(event.endAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      return `${event.titleEn || event.id} needs an end time after its start time.`;
    }
    if (!safeHttpsUrl(event.mapsUrl)) return `${event.titleEn || event.id} needs a safe HTTPS maps link.`;
    if (!Number.isSafeInteger(event.displayOrder)) return `${event.titleEn || event.id} needs a whole-number display order.`;
    if (!Number.isSafeInteger(event.defaultAdultLimit) || !Number.isSafeInteger(event.defaultChildLimit) || event.defaultAdultLimit < 0 || event.defaultChildLimit < 0 || event.defaultAdultLimit > 30 || event.defaultChildLimit > 30) {
      return `${event.titleEn || event.id} needs guest defaults between 0 and 30.`;
    }
    if (event.defaultSelected && event.defaultAdultLimit + event.defaultChildLimit === 0) {
      return `${event.titleEn || event.id} is selected by default, so it needs room for at least one guest.`;
    }
  }
  if (!snapshot.events.some((event) => event.published)) return "Publish at least one event before saving.";
  return null;
}

function isSnapshot(value: unknown): value is CoordinatorContentSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return Boolean(candidate.settings && typeof candidate.settings === "object" && Array.isArray(candidate.contacts) && Array.isArray(candidate.events));
}

function numberValue(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function sectionForValidation(message: string): ContentSection {
  if (/event|schedule|maps|publish|URL label|guest defaults/i.test(message)) return "events";
  if (/contact|mobile|groom|bride/i.test(message)) return "contacts";
  return "settings";
}

function contactLabel(role: ContactRole) {
  return role === "groom" ? "Groom reply-to" : "Bride reply-to";
}

function eventTitle(event: CoordinatorContentEvent) {
  return event.titleEn.trim() || "Untitled event";
}

export function CoordinatorContentEditor({ initialContent }: { initialContent: CoordinatorContentSnapshot }) {
  const router = useRouter();
  const ids = useId();
  const initial = useMemo(() => normalizeSnapshot(initialContent), [initialContent]);
  const [draft, setDraft] = useState<CoordinatorContentSnapshot>(() => deepCopy(initial));
  const [saved, setSaved] = useState<CoordinatorContentSnapshot>(() => deepCopy(initial));
  const [guestContentDraft, setGuestContentDraft] = useState(() => guestContentText(initial.settings.guestContent));
  const [savedGuestContent, setSavedGuestContent] = useState(() => guestContentText(initial.settings.guestContent));
  const [section, setSection] = useState<ContentSection>("settings");
  const [selectedEventId, setSelectedEventId] = useState<string>(() => initial.events[0]?.id ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [latestConflict, setLatestConflict] = useState<CoordinatorContentSnapshot | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(Boolean(initial.settings.guestContent));

  const initialEventIds = useMemo(() => new Set(initial.events.map((event) => event.id)), [initial.events]);
  const selectedEvent = draft.events.find((event) => event.id === selectedEventId) ?? draft.events[0] ?? null;
  const isDirty = serialize(draft) !== serialize(saved) || guestContentDraft !== savedGuestContent;
  const publishedCount = draft.events.filter((event) => event.published).length;

  function updateSettings<Key extends keyof CoordinatorContentSettings>(key: Key, value: CoordinatorContentSettings[Key]) {
    setDraft((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
    setNotice("");
  }

  function updateContact(role: ContactRole, update: Partial<CoordinatorContentContact>) {
    setDraft((current) => ({
      ...current,
      contacts: current.contacts.some((contact) => contact.role === role)
        ? current.contacts.map((contact) => contact.role === role ? { ...contact, ...update } : contact)
        : [...current.contacts, { role, name: "", phone: "", isActive: false, ...update }]
    }));
    setNotice("");
  }

  function updateEvent(id: string, update: Partial<CoordinatorContentEvent>) {
    setDraft((current) => ({
      ...current,
      events: current.events.map((event) => event.id === id ? { ...event, ...update } : event)
    }));
    setNotice("");
  }

  function addEvent() {
    const event = blankEvent(draft.events);
    setDraft((current) => ({ ...current, events: [...current.events, event] }));
    setSelectedEventId(event.id);
    setSection("events");
    setNotice("New event added as an unpublished draft.");
    setError("");
  }

  function archiveOrRemoveEvent(event: CoordinatorContentEvent) {
    const existsInDatabase = initialEventIds.has(event.id);
    if (existsInDatabase) {
      if (!event.published) {
        setNotice(`${eventTitle(event)} is already archived. Remove it from the schedule only after confirming it is not needed by any active invitation.`);
        return;
      }
      const confirmed = window.confirm(
        `Archive ${eventTitle(event)}? It will no longer appear on invitation pages after you save. Existing active links may prevent this change.`
      );
      if (!confirmed) return;
      updateEvent(event.id, { published: false, defaultSelected: false });
      setNotice(`${eventTitle(event)} will be archived when you save.`);
      return;
    }
    const confirmed = window.confirm(`Remove the unsaved ${eventTitle(event)} draft?`);
    if (!confirmed) return;
    setDraft((current) => ({ ...current, events: current.events.filter((entry) => entry.id !== event.id) }));
    const remaining = draft.events.filter((entry) => entry.id !== event.id);
    setSelectedEventId(remaining[0]?.id ?? "");
    setNotice("Unpublished event draft removed.");
    setError("");
  }

  function resetChanges() {
    if (!isDirty || window.confirm("Discard all unsaved content changes?")) {
      setDraft(deepCopy(saved));
      setGuestContentDraft(savedGuestContent);
      setSelectedEventId(saved.events[0]?.id ?? "");
      setError("");
      setLatestConflict(null);
      setNotice("Unsaved changes were discarded.");
    }
  }

  function formatGuestContent() {
    const result = parseGuestContent(guestContentDraft);
    if ("error" in result) {
      setError(result.error);
      setSection("settings");
      return;
    }
    setGuestContentDraft(result.value === null ? "" : guestContentText(result.value));
    setError("");
    setNotice(result.value === null ? "Advanced invitation content is cleared in this draft." : "Advanced invitation content formatted. Save to publish it.");
  }

  function clearGuestContent() {
    if (!guestContentDraft || window.confirm("Clear the advanced invitation content from this draft? You can still discard changes before saving.")) {
      setGuestContentDraft("");
      setError("");
      setNotice("Advanced invitation content will be cleared when you save.");
    }
  }

  function loadLatestConflict() {
    if (!latestConflict) return;
    const latest = deepCopy(latestConflict);
    const formattedGuestContent = guestContentText(latest.settings.guestContent);
    setDraft(latest);
    setSaved(deepCopy(latest));
    setGuestContentDraft(formattedGuestContent);
    setSavedGuestContent(formattedGuestContent);
    setSelectedEventId(latest.events[0]?.id ?? "");
    setLatestConflict(null);
    setError("");
    setNotice("The latest content has been loaded. Review it before making your next change.");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;

    setError("");
    setNotice("");
    setLatestConflict(null);
    const parsedGuestContent = parseGuestContent(guestContentDraft);
    if ("error" in parsedGuestContent) {
      setError(parsedGuestContent.error);
      setSection("settings");
      return;
    }
    const nextDraft: CoordinatorContentSnapshot = {
      ...draft,
      settings: { ...draft.settings, guestContent: parsedGuestContent.value }
    };
    const validationError = validateSnapshot(nextDraft);
    if (validationError) {
      setError(validationError);
      setSection(sectionForValidation(validationError));
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/coordinator/content", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: nextDraft.revision,
          settings: nextDraft.settings,
          contacts: nextDraft.contacts,
          events: nextDraft.events
        })
      });
      const body = await response.json().catch(() => ({})) as SaveResponse;
      if (!response.ok || body.ok !== true) {
        if (response.status === 409 && isSnapshot(body.configuration)) {
          setLatestConflict(normalizeSnapshot(body.configuration));
        }
        setError(typeof body.error === "string" ? body.error : "We could not save the invitation content. Please review the details and try again.");
        return;
      }

      const returnedContent = isSnapshot(body.configuration)
        ? body.configuration
        : isSnapshot(body.content)
          ? body.content
          : null;
      const savedContent = returnedContent
        ? normalizeSnapshot(returnedContent)
        : {
            ...nextDraft,
            revision: typeof body.revision === "string" ? body.revision : nextDraft.revision
          };
      const formattedGuestContent = guestContentText(savedContent.settings.guestContent);
      setDraft(deepCopy(savedContent));
      setSaved(deepCopy(savedContent));
      setGuestContentDraft(formattedGuestContent);
      setSavedGuestContent(formattedGuestContent);
      setSelectedEventId((current) => savedContent.events.some((entry) => entry.id === current) ? current : savedContent.events[0]?.id ?? "");
      setLatestConflict(null);
      setNotice("Wedding content saved. Event details update existing private invitations; invitation defaults apply only to new links.");
      router.refresh();
    } catch {
      setError("We could not save the invitation content. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  const groomContact = draft.contacts.find((contact) => contact.role === "groom") ?? { role: "groom" as const, name: "", phone: "", isActive: false };
  const brideContact = draft.contacts.find((contact) => contact.role === "bride") ?? { role: "bride" as const, name: "", phone: "", isActive: false };
  const hasAnnouncement = Boolean(draft.settings.announcementEn?.trim() || draft.settings.announcementHi?.trim() || draft.settings.announcementStartsAt || draft.settings.announcementEndsAt);

  return (
    <form className={styles.editor} onSubmit={save} noValidate>
      <section className={styles.intro} aria-labelledby={`${ids}-title`}>
        <div>
          <p className={styles.eyebrow}>Coordinator workspace</p>
          <h1 id={`${ids}-title`}>Invitation content</h1>
          <p className={styles.introCopy}>Update wedding details, reply-to contacts, and the event schedule. Save everything together so guests see a consistent invitation.</p>
        </div>
        <aside className={styles.changeSummary} aria-label="Content save status">
          <span className={isDirty ? styles.unsavedDot : styles.savedDot} aria-hidden="true" />
          <div>
            <strong>{isDirty ? "Unsaved changes" : "Everything saved"}</strong>
            <small>{publishedCount} published event{publishedCount === 1 ? "" : "s"} · India Standard Time</small>
          </div>
        </aside>
      </section>

      <div className={styles.layout}>
        <aside className={styles.sectionNav} aria-label="Invitation content sections">
          <div className={styles.sectionNavHeader}>
            <span>Content editor</span>
            <small>Choose what to update</small>
          </div>
          <div className={styles.sectionTabs} role="tablist" aria-orientation="vertical">
            {sectionCopy.map((item) => {
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  id={`${ids}-${item.id}-tab`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`${ids}-${item.id}-panel`}
                  className={active ? styles.activeTab : undefined}
                  onClick={() => setSection(item.id)}
                >
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </button>
              );
            })}
          </div>
          <div className={styles.sectionNavNote}>
            <span aria-hidden="true">⌁</span>
            <p>Event details update active links immediately. Guest limits below only set defaults for future invitations.</p>
          </div>
        </aside>

        <div className={styles.contentPanels}>
          <section
            id={`${ids}-settings-panel`}
            role="tabpanel"
            aria-labelledby={`${ids}-settings-tab`}
            hidden={section !== "settings"}
            className={styles.panel}
          >
            <div className={styles.panelHeading}>
              <div>
                <p className={styles.eyebrow}>Wedding details</p>
                <h2>The details guests see first</h2>
                <span>Both language fields are shown on the invitation, so keep each version ready for guests who switch language.</span>
              </div>
              <span className={styles.timezonePill}>All times IST (India)</span>
            </div>

            <fieldset className={styles.fieldset}>
              <legend>Couple and location</legend>
              <div className={styles.bilingualGrid}>
                <InputField label="Couple names" language="English" value={draft.settings.coupleNamesEn} onChange={(value) => updateSettings("coupleNamesEn", value)} maxLength={160} required />
                <InputField label="Couple names" language="हिन्दी" lang="hi" value={draft.settings.coupleNamesHi} onChange={(value) => updateSettings("coupleNamesHi", value)} maxLength={160} required />
                <InputField label="Displayed wedding date" language="English" value={draft.settings.weddingDateEn} onChange={(value) => updateSettings("weddingDateEn", value)} maxLength={160} required />
                <InputField label="Displayed wedding date" language="हिन्दी" lang="hi" value={draft.settings.weddingDateHi} onChange={(value) => updateSettings("weddingDateHi", value)} maxLength={160} required />
                <InputField label="Location" language="English" value={draft.settings.locationEn} onChange={(value) => updateSettings("locationEn", value)} maxLength={200} required />
                <InputField label="Location" language="हिन्दी" lang="hi" value={draft.settings.locationHi} onChange={(value) => updateSettings("locationHi", value)} maxLength={200} required />
              </div>
            </fieldset>

            <fieldset className={styles.fieldset}>
              <legend>Wedding and RSVP timing <span>IST (India)</span></legend>
              <div className={styles.threeColumnGrid}>
                <DateTimeField label="Wedding moment" value={draft.settings.weddingMoment} onChange={(value) => updateSettings("weddingMoment", value)} required />
                <DateTimeField label="Displayed RSVP deadline" helper="Guests see this as the reply deadline." value={draft.settings.rsvpDeadline} onChange={(value) => updateSettings("rsvpDeadline", value)} required />
                <DateTimeField label="Last-edit cutoff" helper="Guests cannot revise their RSVP after this time." value={draft.settings.canEditUntil} onChange={(value) => updateSettings("canEditUntil", value)} required />
              </div>
            </fieldset>

            <fieldset className={styles.fieldset}>
              <legend>Coordinator fallback</legend>
              <p className={styles.fieldsetCopy}>This is the primary groom reply-to shown when no active groom contact overrides it. Use a real Indian mobile number; it becomes a call and WhatsApp link for guests.</p>
              <div className={styles.twoColumnGrid}>
                <InputField label="Fallback name" value={draft.settings.coordinatorName} onChange={(value) => updateSettings("coordinatorName", value)} maxLength={80} required />
                <InputField label="Fallback Indian mobile" helper="Example: 98765 43210 or +91 98765 43210" inputMode="tel" value={draft.settings.coordinatorPhone} onChange={(value) => updateSettings("coordinatorPhone", value)} maxLength={40} required />
              </div>
            </fieldset>

            <fieldset className={styles.fieldset}>
              <legend className={styles.toggleLegend}>
                <span>Invitation notice</span>
                <label className={styles.switch}>
                  <input
                    type="checkbox"
                    checked={hasAnnouncement}
                    onChange={(event) => {
                      if (event.target.checked) {
                        updateSettings("announcementEn", draft.settings.announcementEn || "");
                        updateSettings("announcementHi", draft.settings.announcementHi || "");
                      } else {
                        setDraft((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            announcementEn: "",
                            announcementHi: "",
                            announcementStartsAt: null,
                            announcementEndsAt: null
                          }
                        }));
                      }
                    }}
                  />
                  <span aria-hidden="true" />
                  <b>{hasAnnouncement ? "On" : "Off"}</b>
                </label>
              </legend>
              <p className={styles.fieldsetCopy}>Show a short, timely update above every invitation. Leave it off when there is nothing guests need to know.</p>
              {hasAnnouncement ? (
                <div className={styles.announcementFields}>
                  <div className={styles.bilingualGrid}>
                    <TextAreaField label="Notice" language="English" value={draft.settings.announcementEn ?? ""} onChange={(value) => updateSettings("announcementEn", value)} maxLength={900} required />
                    <TextAreaField label="Notice" language="हिन्दी" lang="hi" value={draft.settings.announcementHi ?? ""} onChange={(value) => updateSettings("announcementHi", value)} maxLength={900} required />
                  </div>
                  <div className={styles.twoColumnGrid}>
                    <DateTimeField label="Show from" helper="Optional—leave both schedule fields blank to show it now." value={draft.settings.announcementStartsAt ?? ""} onChange={(value) => updateSettings("announcementStartsAt", value || null)} />
                    <DateTimeField label="Hide after" helper="Optional—must be after the start time." value={draft.settings.announcementEndsAt ?? ""} onChange={(value) => updateSettings("announcementEndsAt", value || null)} />
                  </div>
                </div>
              ) : null}
            </fieldset>

            <fieldset className={`${styles.fieldset} ${styles.advancedFieldset}`}>
              <legend className={styles.toggleLegend}>
                <span>Advanced invitation sections</span>
                <button type="button" className={styles.textButton} onClick={() => setShowAdvanced((visible) => !visible)} aria-expanded={showAdvanced}>
                  {showAdvanced ? "Hide editor" : "Edit JSON"}
                </button>
              </legend>
              <p className={styles.fieldsetCopy}>Optional hero, travel, update and blessing copy. Only the supported fixed keys and local artwork choices can be saved; never paste HTML, scripts, or passwords here.</p>
              {showAdvanced ? (
                <div className={styles.advancedContent}>
                  <label className={styles.textareaLabel} htmlFor={`${ids}-guest-content`}>
                    <span>Guest content JSON</span>
                    <textarea
                      id={`${ids}-guest-content`}
                      value={guestContentDraft}
                      onChange={(event) => { setGuestContentDraft(event.target.value); setNotice(""); }}
                      maxLength={MAX_GUEST_CONTENT_CHARS}
                      spellCheck={false}
                      placeholder={'{\n  "hero": {\n    "invocation": "…"\n  }\n}'}
                      aria-describedby={`${ids}-guest-content-help`}
                    />
                  </label>
                  <div className={styles.advancedFooter} id={`${ids}-guest-content-help`}>
                    <span>{guestContentDraft.length.toLocaleString()} / {MAX_GUEST_CONTENT_CHARS.toLocaleString()} characters</span>
                    <div>
                      <button type="button" className={styles.subtleButton} onClick={formatGuestContent}>Format JSON</button>
                      <button type="button" className={styles.dangerTextButton} onClick={clearGuestContent}>Clear draft</button>
                    </div>
                  </div>
                </div>
              ) : null}
            </fieldset>
          </section>

          <section
            id={`${ids}-events-panel`}
            role="tabpanel"
            aria-labelledby={`${ids}-events-tab`}
            hidden={section !== "events"}
            className={styles.panel}
          >
            <div className={styles.panelHeading}>
              <div>
                <p className={styles.eyebrow}>Schedule</p>
                <h2>Plan every celebration</h2>
                <span>Update event details at any time. Published details appear on active invitation links; default guest limits apply only when you create a new one.</span>
              </div>
              <button type="button" className="admin-primary-button" onClick={addEvent}>Add event <span aria-hidden="true">+</span></button>
            </div>

            <div className={styles.eventEditor}>
              <div className={styles.eventList} aria-label="Events">
                {draft.events.map((event) => {
                  const selected = selectedEvent?.id === event.id;
                  return (
                    <button
                      key={event.id}
                      type="button"
                      className={selected ? styles.selectedEvent : undefined}
                      onClick={() => setSelectedEventId(event.id)}
                      aria-pressed={selected}
                    >
                      <span className={event.published ? styles.publishedPill : styles.draftPill}>{event.published ? "Published" : "Draft"}</span>
                      <strong>{eventTitle(event)}</strong>
                      <small>#{event.displayOrder} · {event.dateEn.trim() || "Date to be set"}</small>
                    </button>
                  );
                })}
              </div>

              {selectedEvent ? (
                <EventFields
                  ids={ids}
                  event={selectedEvent}
                  isExisting={initialEventIds.has(selectedEvent.id)}
                  onChange={(update) => updateEvent(selectedEvent.id, update)}
                  onArchiveOrRemove={() => archiveOrRemoveEvent(selectedEvent)}
                />
              ) : (
                <div className={styles.emptyEventEditor}>
                  <strong>No events yet</strong>
                  <span>Add an event to build the invitation schedule.</span>
                  <button type="button" className="admin-outline-button" onClick={addEvent}>Add event</button>
                </div>
              )}
            </div>
          </section>

          <section
            id={`${ids}-contacts-panel`}
            role="tabpanel"
            aria-labelledby={`${ids}-contacts-tab`}
            hidden={section !== "contacts"}
            className={styles.panel}
          >
            <div className={styles.panelHeading}>
              <div>
                <p className={styles.eyebrow}>Guest support</p>
                <h2>Reply-to contacts</h2>
                <span>These details are visible only to people holding a private invitation. Each active contact becomes a one-tap call and WhatsApp option.</span>
              </div>
              <span className={styles.timezonePill}>Private invitation only</span>
            </div>

            <div className={styles.contactGrid}>
              {[groomContact, brideContact].map((contact) => (
                <article className={styles.contactCard} key={contact.role}>
                  <div className={styles.contactCardHeading}>
                    <div>
                      <p>{contact.role === "groom" ? "Primary fallback" : "Optional reply-to"}</p>
                      <h3>{contactLabel(contact.role)}</h3>
                    </div>
                    <label className={styles.switch}>
                      <input type="checkbox" checked={contact.isActive} onChange={(event) => updateContact(contact.role, { isActive: event.target.checked })} />
                      <span aria-hidden="true" />
                      <b>{contact.isActive ? "Active" : "Hidden"}</b>
                    </label>
                  </div>
                  <p className={styles.contactHelp}>{contact.role === "groom" ? "An active groom contact overrides the coordinator fallback in Wedding details." : "Turn this on when guests should be able to contact the bride’s side directly."}</p>
                  <div className={styles.contactFields}>
                    <InputField label="Name" value={contact.name} onChange={(value) => updateContact(contact.role, { name: value })} maxLength={80} required />
                    <InputField label="Indian mobile" helper="Example: 98765 43210" inputMode="tel" value={contact.phone} onChange={(value) => updateContact(contact.role, { phone: value })} maxLength={40} required />
                  </div>
                </article>
              ))}
            </div>
            <aside className={styles.contactSafety}>
              <span aria-hidden="true">⌁</span>
              <p>Do not hide a reply-to contact used by an active invitation. The save check will protect existing guests and explain what needs attention.</p>
            </aside>
          </section>
        </div>
      </div>

      <div className={styles.saveBar}>
        <div aria-live="polite" aria-atomic="true">
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          {!error && notice ? <p className={styles.notice}>{notice}</p> : null}
          {!error && !notice ? <p className={styles.saveHint}>{isDirty ? "Review your changes, then save them together." : "There are no changes waiting to be saved."}</p> : null}
          {latestConflict ? <button type="button" className={styles.reloadButton} onClick={loadLatestConflict}>Load the latest version</button> : null}
        </div>
        <div className={styles.saveActions}>
          <button type="button" className="admin-outline-button" onClick={resetChanges} disabled={!isDirty || isSaving}>Discard changes</button>
          <button type="submit" className="admin-primary-button" disabled={!isDirty || isSaving}>{isSaving ? "Saving…" : "Save invitation content"}</button>
        </div>
      </div>
    </form>
  );
}

function InputField({
  label,
  language,
  helper,
  value,
  onChange,
  lang,
  maxLength,
  inputMode,
  required = false
}: {
  label: string;
  language?: string;
  helper?: string;
  value: string;
  onChange: (value: string) => void;
  lang?: string;
  maxLength: number;
  inputMode?: "tel" | "text";
  required?: boolean;
}) {
  const id = useId();
  return (
    <label className={styles.field} htmlFor={id}>
      <span>{label}{language ? <small>{language}</small> : null}</span>
      <input id={id} lang={lang} value={value} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} inputMode={inputMode} required={required} />
      {helper ? <em>{helper}</em> : null}
    </label>
  );
}

function TextAreaField({
  label,
  language,
  value,
  onChange,
  lang,
  maxLength,
  required = false
}: {
  label: string;
  language?: string;
  value: string;
  onChange: (value: string) => void;
  lang?: string;
  maxLength: number;
  required?: boolean;
}) {
  const id = useId();
  return (
    <label className={styles.field} htmlFor={id}>
      <span>{label}{language ? <small>{language}</small> : null}</span>
      <textarea id={id} lang={lang} value={value} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} required={required} rows={4} />
    </label>
  );
}

function DateTimeField({
  label,
  helper,
  value,
  onChange,
  required = false
}: {
  label: string;
  helper?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const id = useId();
  return (
    <label className={styles.field} htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="datetime-local" step="1" value={indiaDateTimeInputValue(value)} onChange={(event) => onChange(indiaInputToIso(event.target.value))} required={required} />
      {helper ? <em>{helper}</em> : null}
    </label>
  );
}

function EventFields({
  ids,
  event,
  isExisting,
  onChange,
  onArchiveOrRemove
}: {
  ids: string;
  event: CoordinatorContentEvent;
  isExisting: boolean;
  onChange: (update: Partial<CoordinatorContentEvent>) => void;
  onArchiveOrRemove: () => void;
}) {
  const eventId = `${ids}-event-${event.id}`;
  const titleId = `${eventId}-title`;
  return (
    <article className={styles.eventFields} aria-labelledby={titleId}>
      <div className={styles.eventFieldsHeader}>
        <div>
          <p>{isExisting ? "Existing event" : "New event draft"}</p>
          <h3 id={titleId}>{eventTitle(event)}</h3>
          <small>Internal ID: <code>{event.id}</code>{isExisting ? " · This ID is fixed so invitation records remain connected." : " · It will become fixed after saving."}</small>
        </div>
        <label className={styles.publishToggle}>
          <input type="checkbox" checked={event.published} onChange={(change) => onChange({ published: change.target.checked })} />
          <span>
            <strong>{event.published ? "Published" : "Draft"}</strong>
            <small>{event.published ? "Visible on invitation pages" : "Hidden from guests"}</small>
          </span>
        </label>
      </div>

      <fieldset className={styles.compactFieldset}>
        <legend>Event identity and order</legend>
        <div className={styles.eventIdentityGrid}>
          <label className={styles.field}>
            <span>Internal ID</span>
            <input value={event.id} readOnly aria-readonly="true" />
            <em>Generated safely; IDs cannot be changed here.</em>
          </label>
          <InputField label="URL label" helper="Lowercase letters, numbers and hyphens." value={event.slug} onChange={(value) => onChange({ slug: eventIdFrom(value) })} maxLength={100} required />
          <label className={styles.field}>
            <span>Display order</span>
            <input type="number" value={event.displayOrder} onChange={(change) => onChange({ displayOrder: numberValue(change.target.value, event.displayOrder) })} step="1" />
            <em>Lower numbers appear first.</em>
          </label>
          <label className={styles.selectField}>
            <span>Event type</span>
            <select value={event.category} onChange={(change) => onChange({ category: change.target.value as EventCategory })}>
              <option value="celebration">Celebration</option>
              <option value="ceremony">Ceremony</option>
              <option value="reception">Reception</option>
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className={styles.compactFieldset}>
        <legend>Guest-facing schedule <span>IST (India)</span></legend>
        <div className={styles.bilingualGrid}>
          <InputField label="Title" language="English" value={event.titleEn} onChange={(value) => onChange({ titleEn: value, ...(!isExisting && event.slug === event.id ? { slug: eventIdFrom(value) } : {}) })} maxLength={180} required />
          <InputField label="Title" language="हिन्दी" lang="hi" value={event.titleHi} onChange={(value) => onChange({ titleHi: value })} maxLength={180} required />
          <InputField label="Displayed date" language="English" value={event.dateEn} onChange={(value) => onChange({ dateEn: value })} maxLength={180} required />
          <InputField label="Displayed date" language="हिन्दी" lang="hi" value={event.dateHi} onChange={(value) => onChange({ dateHi: value })} maxLength={180} required />
          <InputField label="Displayed start time" language="English" value={event.startTimeEn} onChange={(value) => onChange({ startTimeEn: value })} maxLength={120} required />
          <InputField label="Displayed start time" language="हिन्दी" lang="hi" value={event.startTimeHi} onChange={(value) => onChange({ startTimeHi: value })} maxLength={120} required />
          <InputField label="Arrival window" language="English" value={event.arrivalWindowEn} onChange={(value) => onChange({ arrivalWindowEn: value })} maxLength={300} required />
          <InputField label="Arrival window" language="हिन्दी" lang="hi" value={event.arrivalWindowHi} onChange={(value) => onChange({ arrivalWindowHi: value })} maxLength={300} required />
        </div>
        <div className={styles.twoColumnGrid}>
          <DateTimeField label="Starts" value={event.startAt} onChange={(value) => onChange({ startAt: value })} required />
          <DateTimeField label="Ends" value={event.endAt} onChange={(value) => onChange({ endAt: value })} required />
        </div>
      </fieldset>

      <fieldset className={styles.compactFieldset}>
        <legend>Venue and arrival</legend>
        <div className={styles.bilingualGrid}>
          <InputField label="Venue" language="English" value={event.venueEn} onChange={(value) => onChange({ venueEn: value })} maxLength={240} required />
          <InputField label="Venue" language="हिन्दी" lang="hi" value={event.venueHi} onChange={(value) => onChange({ venueHi: value })} maxLength={240} required />
          <TextAreaField label="Address" language="English" value={event.addressEn} onChange={(value) => onChange({ addressEn: value })} maxLength={600} required />
          <TextAreaField label="Address" language="हिन्दी" lang="hi" value={event.addressHi} onChange={(value) => onChange({ addressHi: value })} maxLength={600} required />
        </div>
        <InputField label="Google Maps link" helper="Use a full https:// link. It opens only when a guest chooses directions." value={event.mapsUrl} onChange={(value) => onChange({ mapsUrl: value })} maxLength={2_000} required />
      </fieldset>

      <fieldset className={styles.compactFieldset}>
        <legend>Guest guidance</legend>
        <div className={styles.bilingualGrid}>
          <TextAreaField label="Entry note" language="English" value={event.entryNoteEn} onChange={(value) => onChange({ entryNoteEn: value })} maxLength={600} required />
          <TextAreaField label="Entry note" language="हिन्दी" lang="hi" value={event.entryNoteHi} onChange={(value) => onChange({ entryNoteHi: value })} maxLength={600} required />
          <InputField label="Dress code" language="English" value={event.dressCodeEn} onChange={(value) => onChange({ dressCodeEn: value })} maxLength={300} required />
          <InputField label="Dress code" language="हिन्दी" lang="hi" value={event.dressCodeHi} onChange={(value) => onChange({ dressCodeHi: value })} maxLength={300} required />
          <TextAreaField label="Practical note" language="English" value={event.practicalNoteEn} onChange={(value) => onChange({ practicalNoteEn: value })} maxLength={600} required />
          <TextAreaField label="Practical note" language="हिन्दी" lang="hi" value={event.practicalNoteHi} onChange={(value) => onChange({ practicalNoteHi: value })} maxLength={600} required />
        </div>
      </fieldset>

      <fieldset className={styles.compactFieldset}>
        <legend>New invitation defaults</legend>
        <p className={styles.fieldsetCopy}>These do not change guest limits on existing links. They only prefill the next invitation you issue.</p>
        <div className={styles.defaultLimits}>
          <label className={styles.defaultCheckbox}>
            <input type="checkbox" checked={event.defaultSelected} onChange={(change) => onChange({ defaultSelected: change.target.checked })} />
            Include this event by default
          </label>
          <label className={styles.field}>
            <span>Adults</span>
            <input type="number" min="0" max="30" step="1" value={event.defaultAdultLimit} onChange={(change) => onChange({ defaultAdultLimit: numberValue(change.target.value, event.defaultAdultLimit) })} />
          </label>
          <label className={styles.field}>
            <span>Children</span>
            <input type="number" min="0" max="30" step="1" value={event.defaultChildLimit} onChange={(change) => onChange({ defaultChildLimit: numberValue(change.target.value, event.defaultChildLimit) })} />
          </label>
        </div>
      </fieldset>

      <div className={styles.eventDangerZone}>
        <div>
          <strong>{isExisting ? "Archive this event" : "Remove draft"}</strong>
          <span>{isExisting ? "Archiving hides it from guests after you save. The service protects active invitation records." : "This event has not been saved yet."}</span>
        </div>
        <button type="button" className={styles.archiveButton} onClick={onArchiveOrRemove} disabled={isExisting && !event.published}>{isExisting ? (event.published ? "Archive event" : "Archived") : "Remove draft"}</button>
      </div>
    </article>
  );
}
