import { NextRequest } from "next/server";

import { rsvpSubmissionSchema } from "@/lib/rsvp";
import { forwardBackendJson, requestBackend } from "@/lib/server/backend-client";
import { privateEmpty, privateJson } from "@/lib/server/private-response";
import { takeRateLimit } from "@/lib/server/rate-limit";
import { bearerTokenRateLimitDigest, clientNetworkIdentifier, isSameOriginRequest, readJsonBody, RSVP_BODY_LIMIT_BYTES } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return privateJson({ error: "This request was blocked." }, 403);
  }

  const networkLimit = await takeRateLimit(`rsvp:network:${clientNetworkIdentifier(request)}`, 30);
  if (!networkLimit.allowed) {
    return privateJson(
      { error: "Please wait a minute before trying again." },
      429,
      { "Retry-After": String(networkLimit.retryAfterSeconds) }
    );
  }

  const body = await readJsonBody(request, RSVP_BODY_LIMIT_BYTES);
  if (!body.ok) {
    if (body.reason === "unsupported_media_type") {
      return privateJson({ error: "This form needs a JSON request." }, 415);
    }
    if (body.reason === "payload_too_large") {
      return privateJson({ error: "The RSVP request is too large." }, 413);
    }
    return privateJson({ error: "Please review the RSVP details and try again." }, 400);
  }

  const parsed = rsvpSubmissionSchema.safeParse(body.value);
  if (!parsed.success) {
    return privateJson({ error: "Please review the RSVP details and try again." }, 400);
  }

  const invitationLimit = await takeRateLimit(`rsvp:invitation:${bearerTokenRateLimitDigest(parsed.data.token)}`, 8);
  if (!invitationLimit.allowed) {
    return privateJson(
      { error: "Please wait a minute before trying again." },
      429,
      { "Retry-After": String(invitationLimit.retryAfterSeconds) }
    );
  }

  try {
    const result = await forwardBackendJson(await requestBackend("/v1/rsvp", {
      method: "POST",
      body: parsed.data
    }));
    return privateJson(result.payload, result.status, result.headers);
  } catch {
    return privateJson({ error: "The invitation service is temporarily unavailable." }, 503);
  }
}

export function GET() {
  return privateJson({ error: "Method not allowed" }, 405, { Allow: "POST" });
}

export function HEAD() {
  return privateEmpty(405, { Allow: "POST" });
}

export function PUT() {
  return privateJson({ error: "Method not allowed" }, 405, { Allow: "POST" });
}

export function PATCH() {
  return privateJson({ error: "Method not allowed" }, 405, { Allow: "POST" });
}

export function DELETE() {
  return privateJson({ error: "Method not allowed" }, 405, { Allow: "POST" });
}

export function OPTIONS() {
  return privateEmpty(204, { Allow: "POST" });
}
