import { NextRequest } from "next/server";
import { z } from "zod";

import { contactNumberSchema, invitationTokenSchema, rsvpDetailsSchema } from "@/lib/rsvp";
import { invitationPath } from "@/lib/wedding-side";
import { forwardBackendJson, requestBackend } from "@/lib/server/backend-client";
import { privateEmpty, privateJson } from "@/lib/server/private-response";
import { takeRateLimit } from "@/lib/server/rate-limit";
import { bearerTokenRateLimitDigest, clientNetworkIdentifier, invitationPublicOrigin, isSameOriginRequest, readJsonBody, RSVP_BODY_LIMIT_BYTES } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const publicRsvpSchema = rsvpDetailsSchema.safeExtend({
  side: z.enum(["groom", "bride"]),
  contactNumber: contactNumberSchema.refine((value) => value.length > 0, "Enter your contact number.")
});

export async function POST(request: NextRequest) {
  if (!request.headers.get("origin") || !isSameOriginRequest(request)) return privateJson({ error: "This request was blocked." }, 403);
  const networkLimit = await takeRateLimit(`public-rsvp:network:${clientNetworkIdentifier(request)}`, 15);
  if (!networkLimit.allowed) return privateJson({ error: "Please wait a minute before trying again." }, 429, { "Retry-After": String(networkLimit.retryAfterSeconds) });
  const body = await readJsonBody(request, RSVP_BODY_LIMIT_BYTES);
  if (!body.ok) return privateJson({ error: body.reason === "payload_too_large" ? "The RSVP request is too large." : "Please review the RSVP details and try again." }, body.reason === "payload_too_large" ? 413 : body.reason === "unsupported_media_type" ? 415 : 400);
  const parsed = publicRsvpSchema.safeParse(body.value);
  if (!parsed.success) return privateJson({ error: parsed.error.issues[0]?.message ?? "Please review the RSVP details and try again." }, 400);
  const contactLimit = await takeRateLimit(`public-rsvp:contact:${parsed.data.side}:${bearerTokenRateLimitDigest(parsed.data.contactNumber.replace(/\D/g, ""))}`, 3);
  if (!contactLimit.allowed) return privateJson({ error: "Please wait a minute before trying again." }, 429, { "Retry-After": String(contactLimit.retryAfterSeconds) });
  const origin = invitationPublicOrigin(request);
  if (!origin) return privateJson({ error: "The invitation service is temporarily unavailable." }, 503);
  try {
    const upstream = await requestBackend("/v1/public/rsvp", { method: "POST", body: parsed.data });
    const result = await forwardBackendJson(upstream);
    if (!upstream.ok) return privateJson(result.payload, result.status, result.headers);
    const payload = result.payload as Record<string, unknown>;
    const token = invitationTokenSchema.parse(payload.token);
    if (payload.ok !== true || typeof payload.updatedAt !== "string") throw new Error("Invalid RSVP response.");
    return privateJson({ ok: true, mode: "database", token, updatedAt: payload.updatedAt, entryPass: payload.entryPass,
      invitationUrl: new URL(invitationPath(parsed.data.side, token), origin).toString() });
  } catch {
    return privateJson({ error: "We could not save your response. Please contact the coordination desk." }, 503);
  }
}

function methodNotAllowed() { return privateJson({ error: "Method not allowed." }, 405, { Allow: "POST" }); }
export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export function HEAD() { return privateEmpty(405, { Allow: "POST" }); }
export function OPTIONS() { return privateEmpty(204, { Allow: "POST" }); }
