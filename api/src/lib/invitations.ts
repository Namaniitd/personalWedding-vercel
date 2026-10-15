import { createHmac } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { invitationTokenSchema, rsvpSubmissionSchema } from "../domain/rsvp.js";
import { resolveDatabaseInvitation } from "./database-invitations.js";
import { configuredHostedSupabaseUrl } from "./hosted-configuration.js";
import { getInvitationStoreMode } from "./invitation-mode.js";
import {
  formatLocalizedDate,
  mapWeddingEvent,
  mapWeddingSettings,
  normalizeDatabaseTimestamp,
  orderWeddingEvents,
  type DatabaseWeddingEventRow,
  type DatabaseWeddingSettingsRow,
  type MappedWeddingEvent
} from "../domain/wedding-content.js";
import { createWeddingContact } from "../domain/wedding-contact.js";
import type { Invitation, RSVPInput, ResolvedInvitation, WeddingSide } from "../domain/types.js";
import { requireWeddingSide } from "../domain/wedding-side.js";

type LiveEventRow = DatabaseWeddingEventRow;

type LiveInvitationRow = {
  id: string;
  household_name_en: string;
  household_name_hi: string;
  preferred_locale: "en" | "hi";
  rsvp_deadline: string;
  can_edit_until: string;
  invitation_events: Array<{
    adult_limit: number;
    child_limit: number;
    event: LiveEventRow | null;
  }>;
};

type SettingsRow = DatabaseWeddingSettingsRow;
type HostedRsvpRow = {
  respondent_name: string;
  status: string;
  comfort_note: string | null;
  decline_message: string | null;
  updated_at: string;
  rsvp_event_attendance: Array<{ event_id: string; is_attending: boolean; adult_count: number; child_count: number }>;
};

export { getInvitationStoreMode, isDatabaseStoreConfigured, isHostedStoreConfigured } from "./invitation-mode.js";
export { DatabaseRsvpClosedError, saveDatabaseRSVP } from "./database-rsvps.js";

export async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  // Fetch forwards arbitrary headers such as Supabase's `apikey` across an
  // automatic cross-origin redirect. Reject redirects before a service-role
  // credential can leave the configured project endpoint.
  return fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(8_000) });
}

function adminClient() {
  const url = configuredHostedSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Supabase server credentials are not configured.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchWithTimeout }
  });
}

export function invitationTokenDigest(token: string) {
  const pepper = process.env.INVITATION_TOKEN_PEPPER;
  if (!pepper) throw new Error("INVITATION_TOKEN_PEPPER is not configured.");
  return createHmac("sha256", pepper).update(token).digest("hex");
}

function coordinatorFromSettings(settings: SettingsRow) {
  return createWeddingContact("groom", settings.coordinator_name, settings.coordinator_phone);
}

function validGuestLimit(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 30;
}

function validHouseholdName(value: unknown) {
  return typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 100;
}

export async function resolveInvitation(token: string, expectedSide?: WeddingSide): Promise<ResolvedInvitation | null> {
  if (!invitationTokenSchema.safeParse(token).success) return null;
  if (expectedSide !== undefined) requireWeddingSide(expectedSide);

  const mode = getInvitationStoreMode();
  if (mode === "database") return resolveDatabaseInvitation(token, expectedSide);
  if (mode !== "hosted") return null;
  // The historical hosted store has no separate bride workspace.
  if (expectedSide === "bride") return null;

  const client = adminClient();
  const tokenHash = invitationTokenDigest(token);
  const [{ data: invitationData, error: invitationError }, { data: settingsData, error: settingsError }] = await Promise.all([
    client
      .from("invitations")
      .select("id, household_name_en, household_name_hi, preferred_locale, rsvp_deadline, can_edit_until, invitation_events!inner(adult_limit, child_limit, event:events!inner(id, slug, title_en, title_hi, date_en, date_hi, start_time_en, start_time_hi, arrival_window_en, arrival_window_hi, start_at, end_at, venue_en, venue_hi, address_en, address_hi, maps_url, entry_note_en, entry_note_hi, dress_code_en, dress_code_hi, practical_note_en, practical_note_hi, category, published, display_order))")
      .eq("token_hash", tokenHash)
      .eq("status", "active")
      .gte("access_expires_at", new Date().toISOString())
      .maybeSingle(),
    client.from("wedding_settings").select("couple_names_en, couple_names_hi, wedding_date_en, wedding_date_hi, location_en, location_hi, wedding_moment, coordinator_name, coordinator_phone, announcement_en, announcement_hi, announcement_starts_at, announcement_ends_at, guest_content").eq("id", 1).maybeSingle()
  ]);

  if (invitationError) throw new Error("Could not load the invitation.");
  if (settingsError) throw new Error("Could not load wedding settings.");
  if (!invitationData) return null;

  const row = invitationData as unknown as LiveInvitationRow;
  const settings = settingsData as SettingsRow | null;
  if (!settings) throw new Error("Wedding settings have not been configured.");
  if (!Array.isArray(row.invitation_events)
    || (row.preferred_locale !== "en" && row.preferred_locale !== "hi")
    || !validHouseholdName(row.household_name_en)
    || !validHouseholdName(row.household_name_hi)) {
    throw new Error("The invitation record is invalid.");
  }
  const wedding = mapWeddingSettings(settings);
  const coordinator = coordinatorFromSettings(settings);
  if (!wedding || !coordinator) throw new Error("Wedding settings are invalid.");

  const eventsWithLimits = row.invitation_events.filter((entry) => entry.event !== null && entry.event.published);
  // Do not expose a household page until it has at least one published event.
  if (eventsWithLimits.length === 0) return null;
  const eventLimits: Invitation["eventLimits"] = {};
  const mappedEvents: MappedWeddingEvent[] = [];
  for (const entry of eventsWithLimits) {
    if (!validGuestLimit(entry.adult_limit) || !validGuestLimit(entry.child_limit)) {
      throw new Error("The invitation event limits are invalid.");
    }
    if (entry.adult_limit + entry.child_limit === 0) {
      throw new Error("Each invitation event needs room for at least one guest.");
    }
    const mapped = mapWeddingEvent(entry.event as LiveEventRow);
    if (!mapped) throw new Error("Wedding event settings are invalid.");
    const event = mapped.event;
    if (eventLimits[event.id]) throw new Error("The invitation contains a duplicate event.");
    eventLimits[event.id] = { adults: entry.adult_limit, children: entry.child_limit };
    mappedEvents.push(mapped);
  }
  const invitationEvents = orderWeddingEvents(mappedEvents);
  // Guests can only change their response through `can_edit_until`; keep the
  // displayed date aligned with the server-enforced cutoff.
  const rsvpDeadline = formatLocalizedDate(row.can_edit_until);
  const rsvpDeadlineIso = normalizeDatabaseTimestamp(row.can_edit_until);
  const deadlineTimestamp = normalizeDatabaseTimestamp(row.rsvp_deadline);
  if (!rsvpDeadline || !rsvpDeadlineIso || !deadlineTimestamp || rsvpDeadlineIso > deadlineTimestamp) {
    throw new Error("The invitation RSVP deadline is invalid.");
  }

  const { data: responseData, error: responseError } = await client.from("rsvps")
    .select("respondent_name, status, comfort_note, decline_message, updated_at, rsvp_event_attendance(event_id, is_attending, adult_count, child_count)")
    .eq("invitation_id", row.id).maybeSingle();
  if (responseError) throw new Error("Could not load the saved RSVP.");
  let rsvp = null;
  if (responseData) {
    const response = responseData as unknown as HostedRsvpRow;
    const updatedAt = normalizeDatabaseTimestamp(response.updated_at);
    if (!updatedAt || !Array.isArray(response.rsvp_event_attendance)) throw new Error("The saved RSVP is invalid.");
    const parsedResponse = rsvpSubmissionSchema.safeParse({
      token, respondentName: response.respondent_name, status: response.status,
      comfortNote: response.comfort_note ?? undefined, declineMessage: response.decline_message ?? undefined,
      attendances: response.rsvp_event_attendance.map((attendance) => ({
        eventId: attendance.event_id, attending: attendance.is_attending,
        adults: attendance.adult_count, children: attendance.child_count
      })), updatedAt
    });
    if (!parsedResponse.success) throw new Error("The saved RSVP is invalid.");
    rsvp = { ...parsedResponse.data, updatedAt };
  }

  return {
    invitation: {
      token,
      side: "groom",
      householdName: { en: row.household_name_en, hi: row.household_name_hi },
      preferredLocale: row.preferred_locale,
      eventIds: invitationEvents.map((event) => event.id),
      eventLimits,
      rsvpDeadline,
      rsvpDeadlineIso,
      coordinator
    },
    events: invitationEvents,
    wedding,
    rsvp
  };
}

export async function saveHostedRSVP(input: RSVPInput) {
  const client = adminClient();
  const { error } = await client.rpc("submit_rsvp", {
    p_token_hash: invitationTokenDigest(input.token),
    p_payload: {
      respondent_name: input.respondentName,
      status: input.status,
      attendances: input.attendances.map((attendance) => ({
        event_id: attendance.eventId,
        attending: attendance.attending,
        adults: attendance.adults,
        children: attendance.children
      })),
      comfort_note: input.comfortNote ?? null,
      decline_message: input.declineMessage ?? null
    }
  });
  if (error) throw new Error("Could not save RSVP.");
}
