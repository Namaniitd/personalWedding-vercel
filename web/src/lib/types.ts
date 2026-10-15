export type Locale = "en" | "hi";

/** Private coordinator and invitation ownership, independent of reply-to contacts. */
export type WeddingSide = "groom" | "bride";

export type LocalizedText = Record<Locale, string>;

/**
 * The only public-domain artwork keys that guest content may select.  Keeping
 * this a closed list means database content can never turn an invitation into
 * an arbitrary remote-image loader.
 */
export type WeddingArtworkKey = "ganesha-basohli" | "gaja-lakshmi";

/** Icons are rendered from code-owned SVGs, never from database markup. */
export type WeddingTravelIcon = "plane" | "train" | "car" | "bed";

export interface WeddingTravelCard {
  icon: WeddingTravelIcon;
  title: LocalizedText;
  body: LocalizedText;
}

export interface WeddingBlessingCard {
  artworkKey: WeddingArtworkKey;
  artworkAlt: LocalizedText;
  label: LocalizedText;
  sanskrit: string;
  translation: LocalizedText;
  citation: string;
}

/**
 * Optional, validated presentation content stored with the wedding settings.
 * It intentionally contains text and fixed asset keys only: no HTML, CSS,
 * scripts, image URLs, or arbitrary icon names are accepted.
 */
export interface WeddingGuestContent {
  hero?: {
    invocation?: string;
    region?: LocalizedText;
    invitationLead?: LocalizedText;
    artworkKey?: WeddingArtworkKey;
    artworkAlt?: LocalizedText;
  };
  travel?: {
    eyebrow?: LocalizedText;
    title: LocalizedText;
    lead?: LocalizedText;
    cards: WeddingTravelCard[];
    help?: {
      title: LocalizedText;
      body: LocalizedText;
    };
  };
  update?: {
    title: LocalizedText;
    body: LocalizedText;
  };
  blessings?: {
    invocation?: string;
    kicker?: LocalizedText;
    title: LocalizedText;
    lead?: LocalizedText;
    cards: WeddingBlessingCard[];
  };
}

export type RSVPStatus = "attending" | "declined" | "confirming";
export type DatabaseInvitationStatus = "active" | "revoked";

/** The person whose reply-to details appear on a guest invitation. */
export type ContactRole = "groom" | "bride";

export interface WeddingContact {
  role: ContactRole;
  name: string;
  phoneDisplay: string;
  phoneHref: string;
  whatsappHref: string;
}

export interface GuestLimit {
  adults: number;
  children: number;
}

/** Optional, bilingual plain-text information shown in an event popup. */
export interface WeddingEventPopupDetail {
  label: LocalizedText;
  value: LocalizedText;
}

export interface WeddingEvent {
  id: string;
  title: LocalizedText;
  date: LocalizedText;
  startTime: LocalizedText;
  arrivalWindow: LocalizedText;
  startIso: string;
  endIso: string;
  venue: LocalizedText;
  address: LocalizedText;
  mapsUrl: string;
  entryNote: LocalizedText;
  dressCode: LocalizedText;
  practicalNote: LocalizedText;
  description?: LocalizedText;
  popupDetails?: WeddingEventPopupDetail[];
  category: "celebration" | "ceremony" | "reception";
}

export interface Invitation {
  /** Omitted only by older deployment contracts. */
  side?: WeddingSide;
  token: string;
  householdName: LocalizedText;
  preferredLocale: Locale;
  eventIds: string[];
  eventLimits: Record<string, GuestLimit>;
  /** The guest-visible, effective cutoff for self-service RSVP changes. */
  rsvpDeadline: LocalizedText;
  /** ISO form of the same self-service RSVP cutoff. */
  rsvpDeadlineIso: string;
  coordinator: WeddingContact;
}

export interface WeddingDetails {
  couple: LocalizedText;
  date: LocalizedText;
  location: LocalizedText;
  weddingMoment: string;
  /** Omitted when no current, scheduled announcement is configured. */
  announcement?: LocalizedText;
  /** Optional sections are rendered only after server-side content validation. */
  guestContent?: WeddingGuestContent;
}

export interface AttendanceInput {
  eventId: string;
  attending: boolean;
  adults: number;
  children: number;
}

export interface RSVPInput {
  token: string;
  respondentName: string;
  status: RSVPStatus;
  attendances: AttendanceInput[];
  comfortNote?: string;
  declineMessage?: string;
  updatedAt?: string;
}

export interface RSVPRecord extends RSVPInput {
  updatedAt: string;
}

/**
 * A guest-visible, household-level QR entry credential. `qrPayload` is an
 * opaque value intended only for the QR renderer: it never contains an
 * invitation URL, bearer invitation token, household name, or RSVP details.
 */
export interface EntryPass {
  qrPayload: string;
  state: "ready" | "checked-in";
  issuedAt: string;
  /** The first successful event-gate scan for this pass, if any. */
  checkedInAt: string | null;
}

/** Non-secret check-in state suitable for a coordinator list. */
export interface DatabaseCoordinatorEntryPass {
  state: "ready" | "checked-in" | "invalidated";
  issuedAt: string;
  invalidatedAt: string | null;
  checkedInAt: string | null;
  /** Successful scans across all events for this pass, never a guest count. */
  scanCount: number;
}

/** Safe event information passed from the coordinator page to its form. */
export interface DatabaseInvitationEventOption {
  id: string;
  title: LocalizedText;
}

/** A safe reply-to choice shown by the database-backed invitation issuer. */
export interface DatabaseInvitationContactOption {
  role: ContactRole;
  name: string;
  phoneDisplay: string;
}

/**
 * Coordinator form defaults. This intentionally contains no
 * invitation token, hash, database URL, or other server secret.
 */
export interface DatabaseInvitationIssuerOptions {
  /** Omitted only by older deployment contracts. */
  side?: WeddingSide;
  events: DatabaseInvitationEventOption[];
  defaultEventLimits: Array<GuestLimit & { eventId: string }>;
  contactOptions: DatabaseInvitationContactOption[];
  defaultContactRole: ContactRole;
}

/**
 * The coordinator-only editing shape for the wedding configuration. It is
 * deliberately explicit instead of exposing a generic database document or
 * any connection metadata to the browser.
 */
export interface DatabaseWeddingContentSettings {
  coupleNamesEn: string;
  coupleNamesHi: string;
  weddingDateEn: string;
  weddingDateHi: string;
  locationEn: string;
  locationHi: string;
  /** ISO timestamp; the coordinator editor presents and saves this in IST. */
  weddingMoment: string;
  /** ISO timestamp; this affects expiry on newly issued links. */
  rsvpDeadline: string;
  /** ISO timestamp; this is the live cutoff for guest RSVP changes. */
  canEditUntil: string;
  coordinatorName: string;
  coordinatorPhone: string;
  announcementEn: string;
  announcementHi: string;
  announcementStartsAt: string | null;
  announcementEndsAt: string | null;
  /**
   * JSON only. It is validated against the fixed code-owned artwork and icon
   * allowlist before it can be saved or shown to guests. `unknown` lets the
   * editor recover a legacy malformed document without rendering it.
   */
  guestContent: unknown | null;
}

export interface DatabaseWeddingContentEvent {
  /** Existing event IDs are immutable so issued invitations keep resolving. */
  id: string;
  slug: string;
  titleEn: string;
  titleHi: string;
  dateEn: string;
  dateHi: string;
  startTimeEn: string;
  startTimeHi: string;
  arrivalWindowEn: string;
  arrivalWindowHi: string;
  startAt: string;
  endAt: string;
  venueEn: string;
  venueHi: string;
  addressEn: string;
  addressHi: string;
  mapsUrl: string;
  entryNoteEn: string;
  entryNoteHi: string;
  dressCodeEn: string;
  dressCodeHi: string;
  practicalNoteEn: string;
  practicalNoteHi: string;
  descriptionEn: string;
  descriptionHi: string;
  popupDetails: WeddingEventPopupDetail[];
  category: WeddingEvent["category"];
  published: boolean;
  displayOrder: number;
  defaultSelected: boolean;
  defaultAdultLimit: number;
  defaultChildLimit: number;
}

export interface DatabaseWeddingContentContact {
  role: ContactRole;
  name: string;
  phone: string;
  isActive: boolean;
}

/** A complete, safe snapshot used by the coordinator content editor. */
export interface DatabaseWeddingContentSnapshot {
  /** Omitted only by older deployment contracts. */
  side?: WeddingSide;
  /** Null only while an empty database is being configured for the first time. */
  revision: string | null;
  settings: DatabaseWeddingContentSettings;
  events: DatabaseWeddingContentEvent[];
  contacts: DatabaseWeddingContentContact[];
}

/**
 * A safe summary for the coordinator page. The raw bearer token and its
 * HMAC digest never appear in this shape, so a link cannot be redisplayed.
 */
export interface DatabaseCoordinatorInvitation {
  id: string;
  householdName: LocalizedText;
  preferredLocale: Locale;
  contactRole: ContactRole;
  status: DatabaseInvitationStatus;
  revokedAt: string | null;
  /**
   * Timestamp-only retention audit for a permanently removed RSVP. It
   * contains no guest response data and is set only after the bearer link is
   * already revoked.
   */
  rsvpDeletedAt: string | null;
  /** Never includes the raw QR payload or its digest. */
  entryPass: DatabaseCoordinatorEntryPass | null;
  eventCount: number;
  eventLimits: Array<GuestLimit & { eventId: string }>;
  createdAt: string;
  rsvp: {
    respondentName: string;
    status: RSVPStatus;
    attendances: AttendanceInput[];
    comfortNote?: string;
    declineMessage?: string;
    updatedAt: string;
  } | null;
}

export interface ResolvedInvitation {
  invitation: Invitation;
  events: WeddingEvent[];
  wedding: WeddingDetails;
  /** Existing RSVP loaded server-side for a private invitation page. */
  rsvp?: RSVPRecord | null;
  /** Present only for an eligible database-backed RSVP; never persist this in browser storage. */
  entryPass?: EntryPass;
}
