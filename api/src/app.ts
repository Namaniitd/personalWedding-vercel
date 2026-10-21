import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { invitationTokenSchema, rsvpSubmissionSchema, validateRSVPForInvitation } from "./domain/rsvp.js";
import { databaseEntryPassCheckInSchema, databaseEntryPassTokenDigest } from "./lib/database-entry-passes.js";
import {
  checkInDatabaseEntryPass,
  databaseInvitationIssueSchema,
  databaseInvitationRevokeSchema,
  databaseInvitationRsvpDeleteSchema,
  deleteDatabaseRSVPForRevokedInvitation,
  getDatabaseInvitationIssuerOptions,
  issueDatabaseInvitation,
  listDatabaseCoordinatorInvitations,
  revokeDatabaseInvitation,
  validateDatabaseInvitationContactRole,
  validateDatabaseInvitationIssue
} from "./lib/database-invitations.js";
import { getDatabasePool, DatabaseRsvpClosedError, saveDatabaseRSVP } from "./lib/database-rsvps.js";
import {
  databaseWeddingContentEditorSchema,
  loadDatabaseWeddingContentEditor,
  saveDatabaseWeddingContentEditor
} from "./lib/database-wedding-content-editor.js";
import { getInvitationStoreMode } from "./lib/invitation-mode.js";
import { resolveInvitation, saveHostedRSVP } from "./lib/invitations.js";
import { takeRateLimit } from "./lib/rate-limit.js";
import { sharedRateLimitSchema, takeDatabaseRateLimit } from "./lib/database-rate-limit.js";
import { coordinatorRsvpSubmissionSchema, saveDatabaseCoordinatorRSVP } from "./lib/database-coordinator-rsvps.js";
import { coordinatorSessionRequestSchema } from "./domain/coordinator-session.js";
import { manageDatabaseCoordinatorSession } from "./lib/database-coordinator-sessions.js";
import { weddingSideSchema } from "./domain/wedding-side.js";
import type { WeddingSide } from "./domain/types.js";
import {
  PublicRsvpValidationError,
  publicInvitationLookupSchema,
  publicRsvpSubmissionSchema,
  resolveDatabasePublicInvitation,
  submitDatabasePublicRSVP
} from "./lib/database-public-rsvps.js";
import {
  BulkInvitationValidationError,
  bulkInvitationIssueSchema,
  issueDatabaseBulkInvitations
} from "./lib/database-bulk-invitations.js";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive"
} as const;

const invitationLookupSchema = z.object({ token: invitationTokenSchema, side: weddingSideSchema.optional() }).strict();

function privateJson(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = new Headers(PRIVATE_HEADERS);
  if (extraHeaders) new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return Response.json(body, { status, headers });
}

function empty(status: number, extraHeaders?: HeadersInit) {
  const headers = new Headers(PRIVATE_HEADERS);
  if (extraHeaders) new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return new Response(null, { status, headers });
}

function configuredServiceToken() {
  const token = process.env.BACKEND_SERVICE_TOKEN;
  return token && /^[A-Za-z0-9_-]{32,256}$/.test(token) ? token : null;
}

/** Authenticate before reading a body or making any database call. */
function serviceAuthorized(request: Request) {
  const configured = configuredServiceToken();
  const supplied = request.headers.get("x-backend-service-token");
  if (!configured || !supplied) return false;
  const suppliedBytes = Buffer.from(supplied);
  const configuredBytes = Buffer.from(configured);
  return suppliedBytes.length === configuredBytes.length
    && timingSafeEqual(suppliedBytes, configuredBytes);
}

type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "unsupported_media_type" | "payload_too_large" | "invalid_json" };

/** Cap the streamed body, including requests without Content-Length. */
async function readJsonBody(request: Request, maximumBytes: number): Promise<JsonBodyResult> {
  const contentType = request.headers.get("content-type");
  if (!contentType || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return { ok: false, reason: "unsupported_media_type" };
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)) {
    return { ok: false, reason: "payload_too_large" };
  }
  if (!request.body) return { ok: false, reason: "invalid_json" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        return { ok: false, reason: "payload_too_large" };
      }
      chunks.push(value);
    }

    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) };
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
  } catch {
    return { ok: false, reason: "invalid_json" };
  } finally {
    reader.releaseLock();
  }
}

function jsonBodyError(result: Extract<JsonBodyResult, { ok: false }>, invalidMessage: string) {
  if (result.reason === "unsupported_media_type") return privateJson({ error: "A JSON request is required." }, 415);
  if (result.reason === "payload_too_large") return privateJson({ error: "This request is too large." }, 413);
  return privateJson({ error: invalidMessage }, 400);
}

async function resolveInvitationRequest(request: Request) {
  const body = await readJsonBody(request, 2 * 1024);
  if (!body.ok) return jsonBodyError(body, "Invitation required.");
  const parsed = invitationLookupSchema.safeParse(body.value);
  if (!parsed.success) return privateJson({ error: "Invitation required." }, 400);

  if (getInvitationStoreMode() === "disabled") {
    return privateJson({ error: "The invitation service is temporarily unavailable." }, 503);
  }
  try {
    const resolved = await resolveInvitation(parsed.data.token, parsed.data.side);
    if (!resolved) return privateJson({ error: "This invitation link is no longer active." }, 404);
    return privateJson({ ok: true, resolved });
  } catch {
    return privateJson({ error: "The invitation service is temporarily unavailable." }, 503);
  }
}

async function submitRsvpRequest(request: Request) {
  const body = await readJsonBody(request, 16 * 1024);
  if (!body.ok) return jsonBodyError(body, "Please review the RSVP details and try again.");
  const parsed = rsvpSubmissionSchema.safeParse(body.value);
  if (!parsed.success) return privateJson({ error: "Please review the RSVP details and try again." }, 400);

  const mode = getInvitationStoreMode();
  if (mode === "disabled") {
    return privateJson({ error: "The invitation service is temporarily unavailable." }, 503);
  }

  let resolved;
  try {
    resolved = await resolveInvitation(parsed.data.token);
  } catch {
    return privateJson({ error: "The invitation service is temporarily unavailable." }, 503);
  }
  if (!resolved) return privateJson({ error: "This invitation link is no longer active." }, 404);

  const validation = validateRSVPForInvitation(parsed.data, resolved);
  if (!validation.ok) return privateJson({ error: validation.message }, 422);

  try {
    if (mode === "hosted") {
      await saveHostedRSVP(validation.value);
      return privateJson({ ok: true, mode: "hosted" });
    }

    const saved = await saveDatabaseRSVP(validation.value);
    return privateJson({
      ok: true,
      mode: "database",
      updatedAt: saved.record.updatedAt,
      entryPass: saved.entryPass
    });
  } catch (error) {
    if (error instanceof DatabaseRsvpClosedError) return privateJson({ error: error.message }, 422);
    return privateJson({ error: "We could not save your response. Please contact the coordination desk." }, 503);
  }
}

async function resolvePublicInvitationRequest(request: Request) {
  if (getInvitationStoreMode() !== "database") return coordinatorUnavailable();
  const body = await readJsonBody(request, 1024);
  if (!body.ok) return jsonBodyError(body, "A wedding side is required.");
  const parsed = publicInvitationLookupSchema.safeParse(body.value);
  if (!parsed.success) return privateJson({ error: "A wedding side is required." }, 400);
  try {
    return privateJson({ ok: true, resolved: await resolveDatabasePublicInvitation(parsed.data.side) });
  } catch {
    return privateJson({ error: "The public invitation is temporarily unavailable." }, 503);
  }
}

async function submitPublicRsvpRequest(request: Request) {
  if (getInvitationStoreMode() !== "database") return coordinatorUnavailable();
  const body = await readJsonBody(request, 16 * 1024);
  if (!body.ok) return jsonBodyError(body, "Please review the RSVP details and try again.");
  const parsed = publicRsvpSubmissionSchema.safeParse(body.value);
  if (!parsed.success) return privateJson({ error: "Please review the RSVP details and enter a valid contact number." }, 400);
  try {
    const saved = await submitDatabasePublicRSVP(parsed.data);
    return privateJson({
      ok: true,
      mode: "database",
      updatedAt: saved.record.updatedAt,
      entryPass: saved.entryPass,
      resolved: saved.resolved,
      token: saved.token
    });
  } catch (error) {
    if (error instanceof PublicRsvpValidationError || error instanceof DatabaseRsvpClosedError) {
      return privateJson({ error: error.message }, 422);
    }
    return privateJson({ error: "We could not save your response. Please contact the coordination desk." }, 503);
  }
}

function coordinatorAvailable() {
  return getInvitationStoreMode() === "database";
}

function coordinatorUnavailable() {
  return privateJson({ error: "Not found." }, 404);
}

async function coordinatorWorkspaceRequest(side: WeddingSide) {
  if (!coordinatorAvailable()) return coordinatorUnavailable();
  try {
    const [issuerOptions, invitations] = await Promise.all([
      getDatabaseInvitationIssuerOptions(side),
      listDatabaseCoordinatorInvitations(side)
    ]);
    return privateJson({ ok: true, issuerOptions, invitations });
  } catch {
    return privateJson({ error: "The coordinator workspace is temporarily unavailable." }, 503);
  }
}

async function coordinatorContentRequest(side: WeddingSide) {
  if (!coordinatorAvailable()) return coordinatorUnavailable();
  try {
    return privateJson({ ok: true, configuration: await loadDatabaseWeddingContentEditor(side) });
  } catch {
    return privateJson({ error: "Wedding content is temporarily unavailable." }, 503);
  }
}

async function coordinatorInvitationsRequest(side: WeddingSide) {
  if (!coordinatorAvailable()) return coordinatorUnavailable();
  try {
    return privateJson({ ok: true, invitations: await listDatabaseCoordinatorInvitations(side) });
  } catch {
    return privateJson({ error: "The coordinator workspace is temporarily unavailable." }, 503);
  }
}

async function saveCoordinatorContentRequest(request: Request, side: WeddingSide) {
  if (!coordinatorAvailable()) return coordinatorUnavailable();
  const body = await readJsonBody(request, 512 * 1024);
  if (!body.ok) return jsonBodyError(body, "Please review the wedding content and try again.");
  const parsed = databaseWeddingContentEditorSchema.safeParse(body.value);
  if (!parsed.success) return privateJson({ error: "Please review the wedding content and try again." }, 400);

  try {
    const result = await saveDatabaseWeddingContentEditor(parsed.data, side);
    if (result.kind === "saved") return privateJson({ ok: true, configuration: result.snapshot });
    if (result.kind === "stale") {
      return privateJson({
        error: "Wedding content changed in another session. Reload the latest version before saving.",
        configuration: result.snapshot
      }, 409);
    }
    if (result.kind === "active_event_reference") {
      return privateJson({ error: "An active invitation still includes an event you tried to archive. Keep it published, or revoke and reissue those links first." }, 409);
    }
    if (result.kind === "active_contact_reference") {
      return privateJson({ error: "An active invitation still uses a contact you tried to disable. Keep that contact active, or revoke and reissue those links first." }, 409);
    }
    if (result.kind === "link_expiry_conflict") {
      return privateJson({ error: "The new RSVP deadline would fall after an existing invitation link expires. Reissue affected links before moving the deadline that far." }, 409);
    }
    if (result.kind === "event_side_conflict") {
      return privateJson({ error: "An event identifier is unavailable. Create a new event before saving." }, 409);
    }
    if (result.kind === "events_missing") {
      return privateJson({ error: "Existing events cannot be deleted here. Archive them instead." }, 409);
    }
    return privateJson({ error: "Existing contacts cannot be deleted here. Disable them instead." }, 409);
  } catch {
    return privateJson({ error: "Wedding content could not be saved right now. Please try again." }, 503);
  }
}

async function issueInvitationRequest(request: Request, side: WeddingSide) {
  if (!coordinatorAvailable()) return coordinatorUnavailable();
  const body = await readJsonBody(request, 8 * 1024);
  if (!body.ok) return jsonBodyError(body, "Please review the invitation details and try again.");
  // The legacy DTO defaults to groom. New side-specific endpoints instead
  // default to their authenticated owner's primary contact, while preserving
  // an explicitly chosen alternate contact inside that same workspace.
  const input = body.value && typeof body.value === "object" && !Array.isArray(body.value)
    && !Object.hasOwn(body.value, "contactRole")
    ? { ...body.value, contactRole: side }
    : body.value;
  const parsed = databaseInvitationIssueSchema.safeParse(input);
  if (!parsed.success) return privateJson({ error: "Please review the invitation details and try again." }, 400);

  try {
    const validation = await validateDatabaseInvitationIssue(parsed.data, side);
    if (!validation.ok) return privateJson({ error: validation.message }, 422);
    const contactValidation = await validateDatabaseInvitationContactRole(validation.value.contactRole, side);
    if (!contactValidation.ok) return privateJson({ error: contactValidation.message }, 422);

    const issued = await issueDatabaseInvitation(validation.value, side);
    // The previous frontend validates this response with a strict schema.
    // Keep its unscoped groom contract until that frontend is upgraded.
    const { side: _issuedSide, ...legacyIssued } = issued;
    return privateJson({ ok: true, issued: request.headers.has("x-wedding-side") ? issued : legacyIssued });
  } catch {
    return privateJson({ error: "The invitation service is temporarily unavailable." }, 503);
  }
}

async function issueBulkInvitationsRequest(request: Request, side: WeddingSide) {
  if (!coordinatorAvailable()) return coordinatorUnavailable();
  const body = await readJsonBody(request, 300 * 1024);
  if (!body.ok) return jsonBodyError(body, "Please review the CSV and invitation details.");
  const input = body.value && typeof body.value === "object" && !Array.isArray(body.value)
    && !Object.hasOwn(body.value, "contactRole")
    ? { ...body.value, contactRole: side }
    : body.value;
  const parsed = bulkInvitationIssueSchema.safeParse(input);
  if (!parsed.success) return privateJson({ error: "Please review the CSV and invitation details. Upload at most 200 guests in a CSV no larger than 256 KiB." }, 400);
  try {
    return privateJson({ ok: true, issued: await issueDatabaseBulkInvitations(parsed.data, side) });
  } catch (error) {
    if (error instanceof BulkInvitationValidationError) return privateJson({ error: error.message }, 422);
    return privateJson({ error: "The invitations could not be created. Please try again." }, 503);
  }
}

async function revokeInvitationRequest(request: Request, side: WeddingSide) {
  if (!coordinatorAvailable()) return coordinatorUnavailable();
  const body = await readJsonBody(request, 2 * 1024);
  if (!body.ok) return jsonBodyError(body, "Please review the invitation and try again.");
  const parsed = databaseInvitationRevokeSchema.safeParse(body.value);
  if (!parsed.success) return privateJson({ error: "Please review the invitation and try again." }, 400);

  try {
    const revoked = await revokeDatabaseInvitation(parsed.data.invitationId, side);
    if (!revoked) return coordinatorUnavailable();
    return privateJson({ ok: true, invitationId: revoked.id, revokedAt: revoked.revokedAt });
  } catch {
    return privateJson({ error: "The invitation service is temporarily unavailable." }, 503);
  }
}

async function deleteRsvpRequest(request: Request, side: WeddingSide) {
  if (!coordinatorAvailable()) return coordinatorUnavailable();
  const body = await readJsonBody(request, 2 * 1024);
  if (!body.ok) return jsonBodyError(body, "Please review the invitation and try again.");
  const parsed = databaseInvitationRsvpDeleteSchema.safeParse(body.value);
  if (!parsed.success) return privateJson({ error: "Please review the invitation and try again." }, 400);

  try {
    const result = await deleteDatabaseRSVPForRevokedInvitation(parsed.data.invitationId, side);
    if (result.kind === "deleted" || result.kind === "already_deleted") {
      return privateJson({ ok: true, invitationId: result.id, rsvpDeletedAt: result.rsvpDeletedAt });
    }
    if (result.kind === "not_revoked") {
      return privateJson({ error: "Disable this invitation before deleting its RSVP." }, 409);
    }
    return coordinatorUnavailable();
  } catch {
    return privateJson({ error: "The invitation service is temporarily unavailable." }, 503);
  }
}

async function checkInRequest(request: Request, side: WeddingSide) {
  if (!coordinatorAvailable()) return privateJson({ error: "Entry pass is unavailable." }, 404);
  const body = await readJsonBody(request, 2 * 1024);
  if (!body.ok) return jsonBodyError(body, "Please scan the entry pass again.");
  const parsed = databaseEntryPassCheckInSchema.safeParse(body.value);
  if (!parsed.success) return privateJson({ error: "Entry pass is unavailable." }, 404);

  const passLimit = await takeRateLimit(`entry-check-in:${side}:pass:${databaseEntryPassTokenDigest(parsed.data.passToken)}`, 30);
  if (!passLimit.allowed) {
    return privateJson({ error: "Please wait a moment before scanning this pass again." }, 429, {
      "Retry-After": String(passLimit.retryAfterSeconds)
    });
  }

  try {
    const result = await checkInDatabaseEntryPass(parsed.data, side);
    if (result.kind === "not_found") return privateJson({ error: "Entry pass is unavailable." }, 404);
    if (result.kind === "not_eligible") {
      return privateJson({ error: "This household is not confirmed for the selected celebration.", code: "not_eligible" }, 422);
    }
    return privateJson({
      ok: true,
      outcome: result.kind,
      householdName: result.householdName,
      event: result.event,
      expectedAdults: result.expectedAdults,
      expectedChildren: result.expectedChildren,
      checkedInAt: result.checkedInAt,
      scanCount: result.scanCount
    });
  } catch {
    return privateJson({ error: "The entry scanner is temporarily unavailable." }, 503);
  }
}

async function coordinatorRsvpRequest(request: Request, side: WeddingSide) {
  if (!coordinatorAvailable()) return coordinatorUnavailable();
  const body = await readJsonBody(request, 16 * 1024);
  if (!body.ok) return jsonBodyError(body, "Please review the RSVP details and try again.");
  const parsed = coordinatorRsvpSubmissionSchema.safeParse(body.value);
  if (!parsed.success) return privateJson({ error: "Please review the RSVP details and try again." }, 400);
  try {
    const result = await saveDatabaseCoordinatorRSVP(parsed.data, side);
    if (result.kind === "saved") return privateJson({ ok: true, updatedAt: result.updatedAt });
    if (result.kind === "stale") {
      return privateJson({ error: "This RSVP changed in another session. Reload its latest response before saving." }, 409);
    }
    if (result.kind === "not_found") return privateJson({ error: "This invitation is no longer active." }, 404);
    return privateJson({ error: "Please answer every invited celebration and review the guest counts against its limits." }, 422);
  } catch {
    return privateJson({ error: "We could not save this RSVP. Please try again." }, 503);
  }
}

async function readinessRequest() {
  if (!configuredServiceToken()) return privateJson({ ok: false }, 503);
  const mode = getInvitationStoreMode();
  if (mode === "disabled") return privateJson({ ok: false }, 503);
  if (mode === "database") {
    try {
      await getDatabasePool().query("SELECT 1");
    } catch {
      return privateJson({ ok: false }, 503);
    }
  }
  return privateJson({ ok: true });
}

async function sharedRateLimitRequest(request: Request) {
  const body = await readJsonBody(request, 1024);
  if (!body.ok) return jsonBodyError(body, "Invalid rate-limit request.");
  const parsed = sharedRateLimitSchema.safeParse(body.value);
  if (!parsed.success) return privateJson({ error: "Invalid rate-limit request." }, 400);
  return privateJson(await takeDatabaseRateLimit(parsed.data));
}

const routeMethods: Record<string, string> = {
  "/v1/readyz": "GET",
  "/v1/status": "GET",
  "/v1/security/rate-limit": "POST",
  "/v1/security/coordinator-session": "POST",
  "/v1/invitations/resolve": "POST",
  "/v1/rsvp": "POST",
  "/v1/public/invitations/resolve": "POST",
  "/v1/public/rsvp": "POST",
  "/v1/coordinator/workspace": "GET",
  "/v1/coordinator/content": "GET, PUT",
  "/v1/coordinator/invitations": "GET, POST",
  "/v1/coordinator/invitations/bulk": "POST",
  "/v1/coordinator/invitations/revoke": "POST",
  "/v1/coordinator/invitations/rsvp/delete": "POST",
  "/v1/coordinator/check-in": "POST",
  "/v1/coordinator/rsvp": "POST"
};

/** Private API router; there are no bearer credentials in any request target. */
export async function handleApiRequest(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/healthz") {
    if (request.method !== "GET" && request.method !== "HEAD") return empty(405, { Allow: "GET, HEAD" });
    const response = privateJson({ ok: true });
    return request.method === "HEAD" ? empty(response.status) : response;
  }
  if (pathname === "/readyz") {
    if (request.method !== "GET" && request.method !== "HEAD") return empty(405, { Allow: "GET, HEAD" });
    const response = await readinessRequest();
    return request.method === "HEAD" ? empty(response.status) : response;
  }

  if (!pathname.startsWith("/v1/")) return privateJson({ error: "Not found." }, 404);
  if (!configuredServiceToken()) return privateJson({ error: "Service unavailable." }, 503);
  if (!serviceAuthorized(request)) return privateJson({ error: "Unauthorized." }, 401);

  const allowed = routeMethods[pathname];
  if (!allowed) return privateJson({ error: "Not found." }, 404);
  if (!allowed.split(", ").includes(request.method)) {
    return privateJson({ error: "Method not allowed." }, 405, { Allow: allowed });
  }

  if (pathname === "/v1/status") {
    const mode = getInvitationStoreMode();
    return privateJson({ mode, coordinatorAvailable: mode === "database", sideIsolation: mode === "database" });
  }
  if (pathname === "/v1/readyz") return readinessRequest();
  if (pathname === "/v1/security/rate-limit") return sharedRateLimitRequest(request);
  if (pathname === "/v1/security/coordinator-session") {
    if (!coordinatorAvailable()) return coordinatorUnavailable();
    const body = await readJsonBody(request, 1024);
    if (!body.ok) return jsonBodyError(body, "Invalid coordinator session request.");
    const parsed = coordinatorSessionRequestSchema.safeParse(body.value);
    if (!parsed.success) return privateJson({ error: "Invalid coordinator session request." }, 400);
    try {
      return privateJson({ ok: await manageDatabaseCoordinatorSession(parsed.data) });
    } catch {
      return privateJson({ error: "The coordinator session store is temporarily unavailable." }, 503);
    }
  }
  if (pathname === "/v1/invitations/resolve") return resolveInvitationRequest(request);
  if (pathname === "/v1/rsvp") return submitRsvpRequest(request);
  if (pathname === "/v1/public/invitations/resolve") return resolvePublicInvitationRequest(request);
  if (pathname === "/v1/public/rsvp") return submitPublicRsvpRequest(request);
  let side: WeddingSide = "groom";
  if (pathname.startsWith("/v1/coordinator/")) {
    const parsedSide = weddingSideSchema.safeParse(request.headers.get("x-wedding-side") ?? "groom");
    if (!parsedSide.success) return privateJson({ error: "Invalid wedding side." }, 400);
    side = parsedSide.data;
  }
  if (pathname === "/v1/coordinator/workspace") return coordinatorWorkspaceRequest(side);
  if (pathname === "/v1/coordinator/content") {
    return request.method === "GET" ? coordinatorContentRequest(side) : saveCoordinatorContentRequest(request, side);
  }
  if (pathname === "/v1/coordinator/invitations") {
    return request.method === "GET" ? coordinatorInvitationsRequest(side) : issueInvitationRequest(request, side);
  }
  if (pathname === "/v1/coordinator/invitations/bulk") return issueBulkInvitationsRequest(request, side);
  if (pathname === "/v1/coordinator/invitations/revoke") return revokeInvitationRequest(request, side);
  if (pathname === "/v1/coordinator/invitations/rsvp/delete") return deleteRsvpRequest(request, side);
  if (pathname === "/v1/coordinator/check-in") return checkInRequest(request, side);
  if (pathname === "/v1/coordinator/rsvp") return coordinatorRsvpRequest(request, side);

  return privateJson({ error: "Not found." }, 404);
}
