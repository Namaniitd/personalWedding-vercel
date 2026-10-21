import { NextRequest } from "next/server";
import { z } from "zod";

import { backendCoordinatorAvailability, forwardBackendJson, requestBackend } from "@/lib/server/backend-client";
import { browserIssuedInvitation, issuedInvitationSchema } from "@/lib/server/issued-invitation";
import { privateEmpty, privateJson } from "@/lib/server/private-response";
import { takeRateLimit } from "@/lib/server/rate-limit";
import { clientNetworkIdentifier, coordinatorRequestSide, invitationPublicOrigin, isAuthorizedCoordinatorRequest, isSameOriginRequest, readJsonBody } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bulkResponseSchema = z.object({ ok: z.literal(true), issued: z.array(issuedInvitationSchema).min(1).max(200) }).strict();

export async function POST(request: NextRequest) {
  if (!request.headers.get("origin") || !isSameOriginRequest(request) || !await isAuthorizedCoordinatorRequest(request)) return privateJson({ error: "This request was blocked." }, 403);
  const availability = await backendCoordinatorAvailability();
  if (availability !== "available") return privateJson({ error: availability === "disabled" ? "Not found." : "The invitation service is temporarily unavailable." }, availability === "disabled" ? 404 : 503);
  const limit = await takeRateLimit(`coordinator-bulk:network:${clientNetworkIdentifier(request)}`, 3);
  if (!limit.allowed) return privateJson({ error: "Please wait a minute before importing another CSV." }, 429, { "Retry-After": String(limit.retryAfterSeconds) });
  const body = await readJsonBody(request, 300 * 1024);
  if (!body.ok) return privateJson({ error: body.reason === "payload_too_large" ? "The CSV request is too large." : "Upload a CSV with name and contactnumber columns." }, body.reason === "payload_too_large" ? 413 : body.reason === "unsupported_media_type" ? 415 : 400);
  const origin = invitationPublicOrigin(request);
  if (!origin) return privateJson({ error: "The invitation service is temporarily unavailable." }, 503);
  try {
    const side = coordinatorRequestSide(request);
    const upstream = await requestBackend("/v1/coordinator/invitations/bulk", { method: "POST", body: body.value, side });
    const result = await forwardBackendJson(upstream);
    if (!upstream.ok) return privateJson(result.payload, result.status, result.headers);
    const parsed = bulkResponseSchema.parse(result.payload);
    return privateJson({ ok: true, invitations: parsed.issued.map((issued) => browserIssuedInvitation(issued, side, origin)) });
  } catch {
    return privateJson({ error: "The invitation import could not be completed. Please check the invitation list before trying again." }, 503);
  }
}

function methodNotAllowed() { return privateJson({ error: "Method not allowed." }, 405, { Allow: "POST" }); }
export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export function HEAD() { return privateEmpty(405, { Allow: "POST" }); }
export function OPTIONS() { return privateEmpty(204, { Allow: "POST" }); }
