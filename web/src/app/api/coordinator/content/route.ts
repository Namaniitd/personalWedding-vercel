import { NextRequest } from "next/server";

import { backendCoordinatorAvailability, forwardBackendJson, requestBackend } from "@/lib/server/backend-client";
import { privateEmpty, privateJson } from "@/lib/server/private-response";
import { takeRateLimit } from "@/lib/server/rate-limit";
import {
  clientNetworkIdentifier,
  coordinatorRequestSide,
  isAuthorizedCoordinatorRequest,
  isSameOriginRequest,
  readJsonBody
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Includes one bounded advanced guest-content document plus the complete
// bilingual schedule. It is intentionally not an arbitrary database dump.
const COORDINATOR_CONTENT_BODY_LIMIT_BYTES = 512 * 1024;

async function databaseCoordinatorIsAvailable(request?: NextRequest) {
  void request;
  return backendCoordinatorAvailability();
}

function unavailable() {
  return privateJson({ error: "Not found." }, 404);
}

function temporarilyUnavailable() {
  return privateJson({ error: "Wedding content is temporarily unavailable." }, 503);
}

function coordinatorCanRead(request: NextRequest) {
  return isAuthorizedCoordinatorRequest(request);
}

async function coordinatorCanWrite(request: NextRequest) {
  return Boolean(request.headers.get("origin"))
    && isSameOriginRequest(request)
    && await isAuthorizedCoordinatorRequest(request);
}

export async function GET(request: NextRequest) {
  const availability = await databaseCoordinatorIsAvailable(request);
  if (availability === "unavailable") return temporarilyUnavailable();
  if (availability === "disabled") return unavailable();
  if (!await coordinatorCanRead(request)) return privateJson({ error: "This request was blocked." }, 403);

  try {
    const result = await forwardBackendJson(await requestBackend("/v1/coordinator/content", { side: coordinatorRequestSide(request) }));
    return privateJson(result.payload, result.status, result.headers);
  } catch {
    return privateJson({ error: "Wedding content is temporarily unavailable." }, 503);
  }
}

export async function PUT(request: NextRequest) {
  const availability = await databaseCoordinatorIsAvailable(request);
  if (availability === "unavailable") return temporarilyUnavailable();
  if (availability === "disabled") return unavailable();
  if (!await coordinatorCanWrite(request)) return privateJson({ error: "This request was blocked." }, 403);

  const limit = await takeRateLimit(`coordinator-content-write:network:${clientNetworkIdentifier(request)}`, 20);
  if (!limit.allowed) {
    return privateJson(
      { error: "Please wait a minute before saving wedding content again." },
      429,
      { "Retry-After": String(limit.retryAfterSeconds) }
    );
  }

  const body = await readJsonBody(request, COORDINATOR_CONTENT_BODY_LIMIT_BYTES);
  if (!body.ok) {
    if (body.reason === "unsupported_media_type") {
      return privateJson({ error: "This form needs a JSON request." }, 415);
    }
    if (body.reason === "payload_too_large") {
      return privateJson({ error: "This wedding-content update is too large." }, 413);
    }
    return privateJson({ error: "Please review the wedding content and try again." }, 400);
  }

  try {
    const result = await forwardBackendJson(await requestBackend("/v1/coordinator/content", {
      side: coordinatorRequestSide(request),
      method: "PUT",
      body: body.value
    }));
    return privateJson(result.payload, result.status, result.headers);
  } catch {
    return privateJson({ error: "Wedding content could not be saved right now. Please try again." }, 503);
  }
}

async function methodNotAllowed(request: NextRequest) {
  const availability = await databaseCoordinatorIsAvailable(request);
  if (availability === "unavailable") return temporarilyUnavailable();
  return availability === "available"
    ? privateJson({ error: "Method not allowed." }, 405, { Allow: "GET, PUT" })
    : unavailable();
}

export async function POST(request: NextRequest) {
  return methodNotAllowed(request);
}

export async function HEAD(request: NextRequest) {
  const availability = await databaseCoordinatorIsAvailable(request);
  return privateEmpty(availability === "available" ? 405 : availability === "disabled" ? 404 : 503,
    availability === "available" ? { Allow: "GET, PUT" } : undefined);
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
    availability === "available" ? { Allow: "GET, PUT" } : undefined);
}
