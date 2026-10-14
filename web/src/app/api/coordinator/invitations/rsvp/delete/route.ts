import { NextRequest } from "next/server";

import { backendCoordinatorAvailability, forwardBackendJson, requestBackend } from "@/lib/server/backend-client";
import { privateEmpty, privateJson } from "@/lib/server/private-response";
import { takeRateLimit } from "@/lib/server/rate-limit";
import {
  clientNetworkIdentifier,
  isAuthorizedCoordinatorRequest,
  isSameOriginRequest,
  readJsonBody
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COORDINATOR_RSVP_DELETE_BODY_LIMIT_BYTES = 2 * 1024;

async function databaseCoordinatorIsAvailable(request?: NextRequest) {
  void request;
  return backendCoordinatorAvailability();
}

function unavailable() {
  return privateJson({ error: "Not found." }, 404);
}

function temporarilyUnavailable() {
  return privateJson({ error: "The invitation service is temporarily unavailable." }, 503);
}

/** Coordinator mutations require a same-origin browser call and signed session. */
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

  const networkLimit = await takeRateLimit(`coordinator-invitation-rsvp-delete:network:${clientNetworkIdentifier(request)}`, 12);
  if (!networkLimit.allowed) {
    return privateJson(
      { error: "Please wait a minute before deleting another RSVP." },
      429,
      { "Retry-After": String(networkLimit.retryAfterSeconds) }
    );
  }

  const body = await readJsonBody(request, COORDINATOR_RSVP_DELETE_BODY_LIMIT_BYTES);
  if (!body.ok) {
    if (body.reason === "unsupported_media_type") {
      return privateJson({ error: "This action needs a JSON request." }, 415);
    }
    if (body.reason === "payload_too_large") {
      return privateJson({ error: "The RSVP deletion request is too large." }, 413);
    }
    return privateJson({ error: "Please review the invitation and try again." }, 400);
  }

  try {
    const result = await forwardBackendJson(await requestBackend("/v1/coordinator/invitations/rsvp/delete", {
      method: "POST",
      body: body.value
    }));
    return privateJson(result.payload, result.status, result.headers);
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
