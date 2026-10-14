import type { NextRequest } from "next/server";
import { z } from "zod";

import { coordinatorRsvpSchema } from "@/lib/coordinator-rsvp";
import { backendCoordinatorAvailability, forwardBackendJson, requestBackend } from "@/lib/server/backend-client";
import { privateEmpty, privateJson } from "@/lib/server/private-response";
import { takeRateLimit } from "@/lib/server/rate-limit";
import { clientNetworkIdentifier, isAuthorizedCoordinatorRequest, isSameOriginRequest, readJsonBody, RSVP_BODY_LIMIT_BYTES } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const savedResponseSchema = z.object({ ok: z.literal(true), updatedAt: z.string().datetime() }).strict();

export async function POST(request: NextRequest) {
  if (!request.headers.get("origin") || !isSameOriginRequest(request) || !await isAuthorizedCoordinatorRequest(request)) {
    return privateJson({ error: "This request was blocked." }, 403);
  }
  const availability = await backendCoordinatorAvailability();
  if (availability !== "available") return privateJson({ error: "The coordinator RSVP service is unavailable." }, availability === "disabled" ? 404 : 503);
  const limit = await takeRateLimit(`coordinator-rsvp:network:${clientNetworkIdentifier(request)}`, 30);
  if (!limit.allowed) return privateJson({ error: "Please wait a minute before recording another reply." }, 429, { "Retry-After": String(limit.retryAfterSeconds) });

  const body = await readJsonBody(request, RSVP_BODY_LIMIT_BYTES);
  if (!body.ok) {
    const status = body.reason === "unsupported_media_type" ? 415 : body.reason === "payload_too_large" ? 413 : 400;
    return privateJson({ error: "Please send a small JSON RSVP request." }, status);
  }
  const parsed = coordinatorRsvpSchema.safeParse(body.value);
  if (!parsed.success) return privateJson({ error: "Please review the RSVP details and try again." }, 400);
  try {
    const upstream = await requestBackend("/v1/coordinator/rsvp", { method: "POST", body: parsed.data });
    const result = await forwardBackendJson(upstream);
    if (!upstream.ok) return privateJson(result.payload, result.status, result.headers);
    const saved = savedResponseSchema.safeParse(result.payload);
    if (!saved.success) throw new Error("Invalid coordinator RSVP response.");
    return privateJson(saved.data);
  } catch {
    return privateJson({ error: "The coordinator RSVP service is temporarily unavailable." }, 503);
  }
}

function methodNotAllowed() { return privateJson({ error: "Method not allowed." }, 405, { Allow: "POST" }); }
export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export function HEAD() { return privateEmpty(405, { Allow: "POST" }); }
export function OPTIONS() { return privateEmpty(204, { Allow: "POST" }); }
