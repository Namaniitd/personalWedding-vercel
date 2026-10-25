"use client";

import { coordinatorApiPath } from "@/lib/wedding-side";

import { type FormEvent, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_INVITATION_LEAD } from "@/lib/invitation-introduction";

import type {
  ContactRole,
  DatabaseWeddingContentContact,
  DatabaseWeddingContentEvent,
  DatabaseWeddingContentSettings,
  DatabaseWeddingContentSnapshot,
  Locale,
  LocalizedText,
  WeddingEventPopupDetail,
  WeddingSide
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
const MAX_EVENT_POPUP_FIELDS = 8;
const popupFieldSuggestions = [
  { en: "Schedule", hi: "कार्यक्रम" },
  { en: "Transport", hi: "परिवहन" },
  { en: "Parking", hi: "पार्किंग" },
  { en: "Dress code", hi: "परिधान" }
];

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
    events: value.events.map((event) => ({
      ...event,
      descriptionEn: textValue(event.descriptionEn),
      descriptionHi: textValue(event.descriptionHi),
      popupDetails: event.popupDetails ?? []
    }))
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

function nextEventId(events: CoordinatorContentEvent[], side: WeddingSide) {
  const used = new Set(events.map((event) => event.id));
  const stem = `${side === "bride" ? "b" : "g"}-event`;
  let number = events.length + 1;
  while (used.has(`${stem}-${number}`)) number += 1;
  return `${stem}-${number}`;
}

function blankEvent(events: CoordinatorContentEvent[], side: WeddingSide): CoordinatorContentEvent {
  const id = nextEventId(events, side);
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
    descriptionEn: "",
    descriptionHi: "",
    popupDetails: [],
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

function isContentObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function invitationIntroduction(value: unknown): LocalizedText {
  const hero = isContentObject(value) && isContentObject(value.hero) ? value.hero : null;
  const lead = hero && isContentObject(hero.invitationLead) ? hero.invitationLead : null;
  return {
    en: typeof lead?.en === "string" ? lead.en : DEFAULT_INVITATION_LEAD.en,
    hi: typeof lead?.hi === "string" ? lead.hi : DEFAULT_INVITATION_LEAD.hi
  };
}

function canEditInvitationIntroduction(value: unknown) {
  if (!isContentObject(value) || value.hero === undefined) return true;
  if (!isContentObject(value.hero)) return false;
  const lead = value.hero.invitationLead;
  return lead === undefined || (isContentObject(lead)
    && (lead.en === undefined || typeof lead.en === "string")
    && (lead.hi === undefined || typeof lead.hi === "string"));
}

function parentNames(value: unknown, side: WeddingSide): LocalizedText {
  const hero = isContentObject(value) && isContentObject(value.hero) ? value.hero : null;
  const parents = hero && isContentObject(hero.parents) ? hero.parents : null;
  const names = parents && isContentObject(parents[side]) ? parents[side] : null;
  return { en: typeof names?.en === "string" ? names.en : "", hi: typeof names?.hi === "string" ? names.hi : "" };
}

function canEditParents(value: unknown) {
  if (!isContentObject(value) || value.hero === undefined) return true;
  if (!isContentObject(value.hero)) return false;
  const parents = value.hero.parents;
  if (parents === undefined) return true;
  return isContentObject(parents) && (["groom", "bride"] as const).every((side) => {
    const names = parents[side];
    return names === undefined || (isContentObject(names)
      && (names.en === undefined || typeof names.en === "string")
      && (names.hi === undefined || typeof names.hi === "string"));
  });
}

function hasAdvancedGuestContent(value: unknown) {
  if (!isContentObject(value)) return Boolean(value);
  if (Object.keys(value).some((key) => key !== "hero")) return true;
  return isContentObject(value.hero)
    ? Object.keys(value.hero).some((key) => key !== "invitationLead" && key !== "parents")
    : value.hero !== undefined;
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
  const introduction = invitationIntroduction(settings.guestContent);
  if (!introduction.en.trim() || !introduction.hi.trim()) {
    return "Write the invitation introduction in both English and Hindi, or use the default wording.";
  }
  for (const side of ["groom", "bride"] as const) {
    const names = parentNames(settings.guestContent, side);
    if (Boolean(names.en.trim()) !== Boolean(names.hi.trim())) {
      return `Write the ${side}'s parents' names in both English and Hindi, or clear both fields.`;
    }
  }
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
    if (Boolean(event.descriptionEn.trim()) !== Boolean(event.descriptionHi.trim())) {
      return `Add the description for ${event.titleEn || event.id} in both languages, or leave both blank.`;
    }
    if (event.descriptionEn.length > 2_400 || event.descriptionHi.length > 2_400) {
      return `The description for ${event.titleEn || event.id} must be no longer than 2,400 characters per language.`;
    }
    if (event.popupDetails.length > MAX_EVENT_POPUP_FIELDS) {
      return `${event.titleEn || event.id} can have up to ${MAX_EVENT_POPUP_FIELDS} popup fields.`;
    }
    for (const [index, detail] of event.popupDetails.entries()) {
      if (fieldIsBlank(detail.label.en) || fieldIsBlank(detail.label.hi) || fieldIsBlank(detail.value.en) || fieldIsBlank(detail.value.hi)) {
        return `Complete the label and content in both languages for popup field ${index + 1} in ${event.titleEn || event.id}, or remove it.`;
      }
      if (detail.label.en.length > 120 || detail.label.hi.length > 120 || detail.value.en.length > 1_200 || detail.value.hi.length > 1_200) {
        return `Popup field ${index + 1} in ${event.titleEn || event.id} needs labels up to 120 characters and content up to 1,200 characters per language.`;
      }
    }
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
  const [showAdvanced, setShowAdvanced] = useState(() => hasAdvancedGuestContent(initial.settings.guestContent));

  const initialEventIds = useMemo(() => new Set(initial.events.map((event) => event.id)), [initial.events]);
  const selectedEvent = draft.events.find((event) => event.id === selectedEventId) ?? draft.events[0] ?? null;
  const isDirty = serialize(draft) !== serialize(saved) || guestContentDraft !== savedGuestContent;
  const publishedCount = draft.events.filter((event) => event.published).length;
  const parsedGuestContentDraft = useMemo(() => parseGuestContent(guestContentDraft), [guestContentDraft]);
  const guestContentObject = "value" in parsedGuestContentDraft && isContentObject(parsedGuestContentDraft.value) ? parsedGuestContentDraft.value : {};
  const introduction = invitationIntroduction(guestContentObject);
  const introductionEditable = !("error" in parsedGuestContentDraft) && canEditInvitationIntroduction(guestContentObject);
  const parentsEditable = !("error" in parsedGuestContentDraft) && canEditParents(guestContentObject);

  function updateParents(side: WeddingSide, locale: Locale, value: string) {
    if (!parentsEditable) return;
    const content = { ...guestContentObject };
    const hero = isContentObject(content.hero) ? { ...content.hero } : {};
    const parents = isContentObject(hero.parents) ? { ...hero.parents } : {};
    const currentNames = isContentObject(parents[side]) ? parents[side] : {};
    const names = { ...currentNames, ...parentNames(content, side), [locale]: value };
    if (!names.en.trim() && !names.hi.trim()) delete parents[side];
    else parents[side] = names;
    if (Object.keys(parents).length) hero.parents = parents;
    else delete hero.parents;
    if (Object.keys(hero).length) content.hero = hero;
    else delete content.hero;
    setGuestContentDraft(Object.keys(content).length ? guestContentText(content) : "");
    setNotice("");
  }

  function updateIntroduction(locale: Locale, value: string) {
    if (!introductionEditable) return;
    const hero = isContentObject(guestContentObject.hero) ? guestContentObject.hero : {};
    const currentLead = isContentObject(hero.invitationLead) ? hero.invitationLead : {};
    setGuestContentDraft(guestContentText({
      ...guestContentObject,
      hero: { ...hero, invitationLead: { ...currentLead, ...introduction, [locale]: value } }
    }));
    setNotice("");
  }

  function resetIntroduction() {
    if (!introductionEditable) return;
    const content = { ...guestContentObject };
    if (isContentObject(content.hero)) {
      const hero = { ...content.hero };
      delete hero.invitationLead;
      if (Object.keys(hero).length) content.hero = hero;
      else delete content.hero;
    }
    setGuestContentDraft(Object.keys(content).length ? guestContentText(content) : "");
    setNotice("Default introduction restored in this draft. Save to publish it.");
    setError("");
  }

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
    const event = blankEvent(draft.events, initialContent.side ?? "groom");
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
      const response = await fetch(coordinatorApiPath("content"), {
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
              <legend>Parents’ names</legend>
              <p className={styles.fieldsetCopy}>Optional names shown beneath the groom and bride on the invitation. Fill both languages for each family, or leave that family blank.</p>
              {!parentsEditable && <p className={styles.fieldsetCopy}>Fix the parents or hero in the advanced JSON editor below before editing these fields.</p>}
              <div className={styles.bilingualGrid}>
                {(["groom", "bride"] as const).flatMap((side) => {
                  const names = parentNames(guestContentObject, side);
                  const label = side === "groom" ? "Groom’s parents" : "Bride’s parents";
                  return [
                    <InputField key={`${side}-en`} label={label} language="English" value={names.en} onChange={(value) => updateParents(side, "en", value)} maxLength={240} disabled={!parentsEditable} />,
                    <InputField key={`${side}-hi`} label={label} language="हिन्दी" lang="hi" value={names.hi} onChange={(value) => updateParents(side, "hi", value)} maxLength={240} disabled={!parentsEditable} />
                  ];
                })}
              </div>
            </fieldset>

            <fieldset className={styles.fieldset}>
              <legend className={styles.toggleLegend}>
                <span>Invitation introduction</span>
                <button type="button" className={styles.textButton} disabled={!introductionEditable} onClick={resetIntroduction}>Use default wording</button>
              </legend>
              <p className={styles.fieldsetCopy}>This appears above the couple names. Keep the default wording or write your own in both languages.</p>
              {!introductionEditable && <p className={styles.fieldsetCopy}>Fix the introduction or hero in the advanced JSON editor below before editing these fields.</p>}
              <div className={styles.bilingualGrid}>
                <TextAreaField label="Invitation introduction" language="English" value={introduction.en} onChange={(value) => updateIntroduction("en", value)} maxLength={600} required disabled={!introductionEditable} />
                <TextAreaField label="Invitation introduction" language="हिन्दी" lang="hi" value={introduction.hi} onChange={(value) => updateIntroduction("hi", value)} maxLength={600} required disabled={!introductionEditable} />
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
              <p className={styles.fieldsetCopy}>This is the primary {initialContent.side === "bride" ? "bride" : "groom"} reply-to shown when no active contact for this side overrides it. Use a real Indian mobile number; it becomes a call and WhatsApp link for guests.</p>
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
                      <p>{contact.role === (initialContent.side ?? "groom") ? "Primary fallback" : "Optional reply-to"}</p>
                      <h3>{contactLabel(contact.role)}</h3>
                    </div>
                    <label className={styles.switch}>
                      <input type="checkbox" checked={contact.isActive} onChange={(event) => updateContact(contact.role, { isActive: event.target.checked })} />
                      <span aria-hidden="true" />
                      <b>{contact.isActive ? "Active" : "Hidden"}</b>
                    </label>
                  </div>
                  <p className={styles.contactHelp}>{contact.role === (initialContent.side ?? "groom") ? `An active ${contact.role} contact overrides the coordinator fallback in Wedding details.` : `Turn this on when guests should be able to contact the ${contact.role}’s side directly.`}</p>
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
  required = false,
  disabled = false
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
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label className={styles.field} htmlFor={id}>
      <span>{label}{language ? <small>{language}</small> : null}</span>
      <input id={id} lang={lang} value={value} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} inputMode={inputMode} required={required} disabled={disabled} />
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
  required = false,
  disabled = false
}: {
  label: string;
  language?: string;
  value: string;
  onChange: (value: string) => void;
  lang?: string;
  maxLength: number;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label className={styles.field} htmlFor={id}>
      <span>{label}{language ? <small>{language}</small> : null}</span>
      <textarea id={id} lang={lang} value={value} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} required={required} disabled={disabled} rows={4} />
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
  function updatePopupField(index: number, update: Partial<WeddingEventPopupDetail>) {
    onChange({ popupDetails: event.popupDetails.map((detail, detailIndex) => detailIndex === index ? { ...detail, ...update } : detail) });
  }
  function addPopupField(label = { en: "", hi: "" }) {
    if (event.popupDetails.length >= MAX_EVENT_POPUP_FIELDS) return;
    onChange({ popupDetails: [...event.popupDetails, { label: { ...label }, value: { en: "", hi: "" } }] });
  }
  function movePopupField(index: number, offset: -1 | 1) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= event.popupDetails.length) return;
    const popupDetails = [...event.popupDetails];
    [popupDetails[index], popupDetails[targetIndex]] = [popupDetails[targetIndex], popupDetails[index]];
    onChange({ popupDetails });
  }
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
        <legend>Event popup</legend>
        <p className={styles.fieldsetCopy}>Guests open these details by choosing the event name in their invitation. Add an introduction and any fields this event needs. Leave both descriptions blank if you only want custom fields.</p>
        <div className={styles.bilingualGrid}>
          <TextAreaField label="Description" language="English" value={event.descriptionEn} onChange={(value) => onChange({ descriptionEn: value })} maxLength={2_400} />
          <TextAreaField label="Description" language="हिन्दी" lang="hi" value={event.descriptionHi} onChange={(value) => onChange({ descriptionHi: value })} maxLength={2_400} />
        </div>
        <div className={styles.popupSuggestions}>
          <span>Suggested labels</span>
          {popupFieldSuggestions.map((label) => (
            <button key={label.en} type="button" onClick={() => addPopupField(label)} disabled={event.popupDetails.length >= MAX_EVENT_POPUP_FIELDS}>+ {label.en}</button>
          ))}
        </div>
        <div className={styles.popupFieldList}>
          {event.popupDetails.map((detail, index) => (
            <section key={index} className={styles.popupFieldCard} aria-label={`Custom popup field ${index + 1}`}>
              <div className={styles.popupFieldHeader}>
                <strong>Custom field {index + 1}</strong>
                <div className={styles.popupFieldActions}>
                  <button type="button" aria-label={`Move popup field ${index + 1} up`} onClick={() => movePopupField(index, -1)} disabled={index === 0}>Move up</button>
                  <button type="button" aria-label={`Move popup field ${index + 1} down`} onClick={() => movePopupField(index, 1)} disabled={index === event.popupDetails.length - 1}>Move down</button>
                  <button type="button" aria-label={`Remove popup field ${index + 1}`} onClick={() => onChange({ popupDetails: event.popupDetails.filter((_, detailIndex) => detailIndex !== index) })}>Remove</button>
                </div>
              </div>
              <div className={styles.bilingualGrid}>
                <InputField label="Field label" language="English" value={detail.label.en} onChange={(value) => updatePopupField(index, { label: { ...detail.label, en: value } })} maxLength={120} required />
                <InputField label="Field label" language="हिन्दी" lang="hi" value={detail.label.hi} onChange={(value) => updatePopupField(index, { label: { ...detail.label, hi: value } })} maxLength={120} required />
                <TextAreaField label="Field content" language="English" value={detail.value.en} onChange={(value) => updatePopupField(index, { value: { ...detail.value, en: value } })} maxLength={1_200} required />
                <TextAreaField label="Field content" language="हिन्दी" lang="hi" value={detail.value.hi} onChange={(value) => updatePopupField(index, { value: { ...detail.value, hi: value } })} maxLength={1_200} required />
              </div>
            </section>
          ))}
        </div>
        <div className={styles.popupFieldFooter}>
          <button type="button" className="admin-outline-button" onClick={() => addPopupField()} disabled={event.popupDetails.length >= MAX_EVENT_POPUP_FIELDS}>Add custom field</button>
          <span>{event.popupDetails.length} of {MAX_EVENT_POPUP_FIELDS} fields · All labels and content are editable.</span>
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
