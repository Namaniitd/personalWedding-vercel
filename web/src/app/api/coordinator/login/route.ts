import { z } from "zod";
import { NextRequest } from "next/server";

import { backendCoordinatorAvailability } from "@/lib/server/backend-client";
import { privateEmpty, privateJson } from "@/lib/server/private-response";
import { takeRateLimit } from "@/lib/server/rate-limit";
import {
  clientNetworkIdentifier,
  COORDINATOR_SESSION_COOKIE,
  coordinatorSessionCookieOptions,
  coordinatorTotpCounter,
  coordinatorTotpReplayIdentifier,
  createCoordinatorSession,
  isAuthorizedCoordinatorPassword,
  isCoordinatorAuthConfigured,
  isCoordinatorTotpRequired,
  isSameOriginRequest,
  registerCoordinatorSession,
  readJsonBody
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COORDINATOR_LOGIN_BODY_LIMIT_BYTES = 2 * 1024;
const loginSchema = z.object({
  password: z.string().max(512),
  code: z.string().regex(/^\d{6}$/).optional()
}).strict();

async function loginAvailability(request?: NextRequest) {
  void request;
  return backendCoordinatorAvailability();
}

function unavailable(serviceDown = false) {
  return privateJson({
    error: serviceDown
      ? "Coordinator sign-in is temporarily unavailable."
      : "Coordinator access requires a complete direct PostgreSQL configuration."
  }, 503);
}

/**
 * Establish a coordinator session. The password is received once,
 * compared server-side, and never placed in a browser-readable credential.
 */
export async function POST(request: NextRequest) {
  const availability = await loginAvailability(request);
  if (availability !== "available") return unavailable(availability === "unavailable");
  if (!request.headers.get("origin") || !isSameOriginRequest(request)) {
    return privateJson({ error: "This request was blocked." }, 403);
  }
  if (!isCoordinatorAuthConfigured()) {
    return privateJson({ error: "Coordinator sign-in is not configured." }, 503);
  }

  const body = await readJsonBody(request, COORDINATOR_LOGIN_BODY_LIMIT_BYTES);
  if (!body.ok) {
    if (body.reason === "unsupported_media_type") {
      return privateJson({ error: "This form needs a JSON request." }, 415);
    }
    if (body.reason === "payload_too_large") {
      return privateJson({ error: "Please enter a shorter password." }, 413);
    }
    return privateJson({ error: "Please enter your coordinator password." }, 400);
  }

  const parsed = loginSchema.safeParse(body.value);
  if (!parsed.success) return privateJson({ error: "Please enter your coordinator password." }, 400);

  const limit = await takeRateLimit(`coordinator-login:network:${clientNetworkIdentifier(request)}`, 8);
  if (!limit.allowed) {
    return privateJson(
      { error: "Please wait a minute before trying again." },
      429,
      { "Retry-After": String(limit.retryAfterSeconds) }
    );
  }
  const passwordMatches = isAuthorizedCoordinatorPassword(parsed.data.password);
  const totpRequired = isCoordinatorTotpRequired();
  const counter = totpRequired ? coordinatorTotpCounter(parsed.data.code) : null;
  if (!passwordMatches || (totpRequired && counter === null)) {
    return privateJson({ error: totpRequired
      ? "The password or authenticator code is incorrect."
      : "The coordinator password is incorrect." }, 401);
  }
  if (counter !== null) {
    const identifier = coordinatorTotpReplayIdentifier(counter);
    // A valid code may be used for one session only, across all Vercel
    // instances. Two minutes outlast its complete accepted time window.
    const consumed = identifier ? await takeRateLimit(identifier, 1, 120_000) : null;
    if (!consumed?.allowed) {
      return privateJson({ error: "This code has already been used. Wait for the next authenticator code and try again." }, 401);
    }
  }

  const session = createCoordinatorSession();
  if (!session) return privateJson({ error: "Coordinator sign-in is not configured." }, 503);
  if (!await registerCoordinatorSession(session)) return unavailable(true);

  const response = privateJson({ ok: true });
  response.cookies.set({
    name: COORDINATOR_SESSION_COOKIE,
    value: session,
    ...coordinatorSessionCookieOptions(request)
  });
  return response;
}

async function methodNotAllowed(request: NextRequest) {
  const availability = await loginAvailability(request);
  return availability === "available"
    ? privateEmpty(405, { Allow: "POST" })
    : unavailable(availability === "unavailable");
}

export async function GET(request: NextRequest) {
  return methodNotAllowed(request);
}

export async function HEAD(request: NextRequest) {
  return methodNotAllowed(request);
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
  const availability = await loginAvailability(request);
  return privateEmpty(availability === "available" ? 204 : availability === "disabled" ? 404 : 503,
    availability === "available" ? { Allow: "POST" } : undefined);
}
