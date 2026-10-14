import { NextRequest } from "next/server";
import { z } from "zod";

import { invitationTokenSchema } from "@/lib/rsvp";
import { backendCoordinatorAvailability, forwardBackendJson, requestBackend } from "@/lib/server/backend-client";
import { privateEmpty, privateJson } from "@/lib/server/private-response";
import { takeRateLimit } from "@/lib/server/rate-limit";
import {
  clientNetworkIdentifier,
  invitationPublicOrigin,
  isAuthorizedCoordinatorRequest,
  isSameOriginRequest,
  readJsonBody
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COORDINATOR_INVITATION_BODY_LIMIT_BYTES = 8 * 1024;
const issuedResponseSchema = z.object({
  ok: z.literal(true),
  issued: z.object({
    id: z.string().uuid(),
    token: invitationTokenSchema,
    createdAt: z.string().datetime(),
    householdName: z.object({ en: z.string(), hi: z.string() }).strict(),
    eventCount: z.number().int().min(1).max(12),
    contactRole: z.enum(["groom", "bride"])
  }).strict()
}).strict();

async function databaseCoordinatorIsAvailable(request?: NextRequest) {
  void request;
  return backendCoordinatorAvailability();
}

function unavailable() {
  // Do not advertise an issuer endpoint when the coordinator console is unavailable.
  return privateJson({ error: "Not found." }, 404);
}

function temporarilyUnavailable() {
  return privateJson({ error: "The invitation service is temporarily unavailable." }, 503);
}

/**
 * Unlike RSVP submissions, this coordinator mutation has no alternate
 * non-browser client. A matching Origin plus the signed session makes the
 * endpoint fail closed for direct network and cross-site browser requests.
 */
async function isCoordinatorRequest(request: NextRequest) {
  return Boolean(request.headers.get("origin"))
    && isSameOriginRequest(request)
    && await isAuthorizedCoordinatorRequest(request);
}

export async function POST(request: NextRequest) {
  const availability = await databaseCoordinatorIsAvailable(request);
  if (availability === "unavailable") return temporarilyUnavailable();
  if (availability === "disabled") return unavailable();
  if (!await isCoordinatorRequest(request)) {
    return privateJson({ error: "This request was blocked." }, 403);
  }

  const networkLimit = await takeRateLimit(`coordinator-invitation:network:${clientNetworkIdentifier(request)}`, 12);
  if (!networkLimit.allowed) {
    return privateJson(
      { error: "Please wait a minute before creating another invitation." },
      429,
      { "Retry-After": String(networkLimit.retryAfterSeconds) }
    );
  }

  const body = await readJsonBody(request, COORDINATOR_INVITATION_BODY_LIMIT_BYTES);
  if (!body.ok) {
    if (body.reason === "unsupported_media_type") {
      return privateJson({ error: "This form needs a JSON request." }, 415);
    }
    if (body.reason === "payload_too_large") {
      return privateJson({ error: "The invitation request is too large." }, 413);
    }
    return privateJson({ error: "Please review the invitation details and try again." }, 400);
  }

  const invitationOrigin = invitationPublicOrigin(request);
  if (!invitationOrigin) {
    return privateJson({ error: "The invitation service is temporarily unavailable." }, 503);
  }

  try {
    const upstream = await requestBackend("/v1/coordinator/invitations", {
      method: "POST",
      body: body.value
    });
    const result = await forwardBackendJson(upstream);
    if (!upstream.ok) return privateJson(result.payload, result.status, result.headers);
    const parsed = issuedResponseSchema.safeParse(result.payload);
    if (!parsed.success) throw new Error("Invalid private API response.");
    const issued = parsed.data.issued;
    // The raw token exists only in this no-store response and in the browser's
    // in-memory copy panel. It is not included in coordinator listing APIs.
    // A production request can arrive from an internal ALB/container origin.
    // Public links must use the independently validated canonical origin.
    const invitationUrl = new URL(`/i/${issued.token}`, invitationOrigin).toString();
    return privateJson({
      ok: true,
      invitationId: issued.id,
      createdAt: issued.createdAt,
      invitationUrl,
      householdName: issued.householdName,
      eventCount: issued.eventCount,
      contactRole: issued.contactRole
    });
  } catch {
    return privateJson({ error: "The invitation service is temporarily unavailable." }, 503);
  }
}

async function methodNotAllowed(request: NextRequest) {
  const availability = await databaseCoordinatorIsAvailable(request);
  if (availability === "unavailable") return temporarilyUnavailable();
  return availability === "available"
    ? privateJson({ error: "Method not allowed." }, 405, { Allow: "POST" })
    : unavailable();
}

export async function GET(request: NextRequest) {
  return methodNotAllowed(request);
}

export async function HEAD(request: NextRequest) {
  const availability = await databaseCoordinatorIsAvailable(request);
  return privateEmpty(availability === "available" ? 405 : availability === "disabled" ? 404 : 503,
    availability === "available" ? { Allow: "POST" } : undefined);
}

export async function PUT(request: NextRequest) {
  return methodNotAllowed(request);
}

export async function PATCH(request: NextRequest) {
  return methodNotAllowed(request);
}

export async function DELETE(request: NextRequest) {
  return methodNotAllowed(request);
}

export async function OPTIONS(request: NextRequest) {
  const availability = await databaseCoordinatorIsAvailable(request);
  return privateEmpty(availability === "available" ? 204 : availability === "disabled" ? 404 : 503,
    availability === "available" ? { Allow: "POST" } : undefined);
}
