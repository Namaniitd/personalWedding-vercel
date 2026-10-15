import { NextRequest } from "next/server";
import { z } from "zod";

import { entryPassTokenSchema } from "@/lib/entry-pass";
import { backendCoordinatorAvailability, forwardBackendJson, requestBackend } from "@/lib/server/backend-client";
import { privateEmpty, privateJson } from "@/lib/server/private-response";
import { takeRateLimit } from "@/lib/server/rate-limit";
import {
  clientNetworkIdentifier,
  coordinatorRequestSide,
  bearerTokenRateLimitDigest,
  isAuthorizedCoordinatorRequest,
  isSameOriginRequest,
  readJsonBody
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COORDINATOR_ENTRY_CHECK_IN_BODY_LIMIT_BYTES = 2 * 1024;
const checkInSchema = z.object({
  passToken: entryPassTokenSchema,
  eventId: z.string().min(1).max(100)
}).strict();

async function databaseCoordinatorIsAvailable(request?: NextRequest) {
  void request;
  return backendCoordinatorAvailability();
}

function unavailable() {
  // Keep unknown, revoked, and stale QR credentials indistinguishable.
  return privateJson({ error: "Entry pass is unavailable." }, 404);
}

function temporarilyUnavailable() {
  return privateJson({ error: "The entry scanner is temporarily unavailable." }, 503);
}

async function isCoordinatorRequest(request: NextRequest) {
  // Proxy redirects unauthenticated page requests, but retain this check in
  // the route so a future matcher change cannot turn the scanner into an open
  // network API.
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

  // A venue device legitimately scans many households from one network. The
  // per-pass limiter still contains accidental repeated submissions without
  // making a busy entrance queue wait on an unrelated household's scan.
  const networkLimit = await takeRateLimit(`coordinator-entry-check-in:network:${clientNetworkIdentifier(request)}`, 120);
  if (!networkLimit.allowed) {
    return privateJson(
      { error: "Please wait a moment before scanning again." },
      429,
      { "Retry-After": String(networkLimit.retryAfterSeconds) }
    );
  }

  const body = await readJsonBody(request, COORDINATOR_ENTRY_CHECK_IN_BODY_LIMIT_BYTES);
  if (!body.ok) {
    if (body.reason === "unsupported_media_type") {
      return privateJson({ error: "This action needs a JSON request." }, 415);
    }
    if (body.reason === "payload_too_large") {
      return privateJson({ error: "The scan request is too large." }, 413);
    }
    return privateJson({ error: "Please scan the entry pass again." }, 400);
  }

  const parsed = checkInSchema.safeParse(body.value);
  if (!parsed.success) return unavailable();

  const passLimit = await takeRateLimit(
    // Keep even the in-process limiter from retaining a raw QR credential.
    `coordinator-entry-check-in:pass:${bearerTokenRateLimitDigest(parsed.data.passToken)}`,
    30
  );
  if (!passLimit.allowed) {
    return privateJson(
      { error: "Please wait a moment before scanning this pass again." },
      429,
      { "Retry-After": String(passLimit.retryAfterSeconds) }
    );
  }

  try {
    const result = await forwardBackendJson(await requestBackend("/v1/coordinator/check-in", {
      side: coordinatorRequestSide(request),
      method: "POST",
      body: parsed.data
    }));
    return privateJson(result.payload, result.status, result.headers);
  } catch {
    return privateJson({ error: "The entry scanner is temporarily unavailable." }, 503);
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
