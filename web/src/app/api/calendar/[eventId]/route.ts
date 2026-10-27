import { NextRequest } from "next/server";
import { z } from "zod";

import { createCalendarEvent } from "@/lib/calendar";
import { invitationTokenSchema } from "@/lib/rsvp";
import { resolveBackendInvitation, resolvePublicInvitation } from "@/lib/server/backend-client";
import { privateEmpty, privateText } from "@/lib/server/private-response";
import { takeRateLimit } from "@/lib/server/rate-limit";
import { bearerTokenRateLimitDigest, CALENDAR_BODY_LIMIT_BYTES, clientNetworkIdentifier, isSameOriginRequest, readJsonBody } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const calendarLocaleSchema = z.enum(["en", "hi"]).default("en");
const calendarRequestSchema = z.union([
  z.object({ token: invitationTokenSchema, locale: calendarLocaleSchema }).strict(),
  z.object({ publicSide: z.enum(["groom", "bride"]), locale: calendarLocaleSchema }).strict()
]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!/^[A-Za-z0-9-]{1,100}$/.test(eventId)) {
    return privateText("The requested calendar item is unavailable.", 404);
  }
  if (!isSameOriginRequest(request)) {
    return privateText("This request was blocked.", 403);
  }

  const networkLimit = await takeRateLimit(`calendar:network:${clientNetworkIdentifier(request)}`, 60);
  if (!networkLimit.allowed) {
    return privateText("Please wait a minute before trying again.", 429, {
      "Retry-After": String(networkLimit.retryAfterSeconds)
    });
  }

  const body = await readJsonBody(request, CALENDAR_BODY_LIMIT_BYTES);
  if (!body.ok) {
    if (body.reason === "unsupported_media_type") return privateText("A JSON request is required.", 415);
    if (body.reason === "payload_too_large") return privateText("The calendar request is too large.", 413);
    return privateText("Invitation required.", 400);
  }

  const parsed = calendarRequestSchema.safeParse(body.value);
  if (!parsed.success) return privateText("Invitation required.", 400);

  const invitationLimit = await takeRateLimit("token" in parsed.data
    ? `calendar:invitation:${bearerTokenRateLimitDigest(parsed.data.token)}`
    : `calendar:public:${clientNetworkIdentifier(request)}:${parsed.data.publicSide}`, 20);
  if (!invitationLimit.allowed) {
    return privateText("Please wait a minute before trying again.", 429, {
      "Retry-After": String(invitationLimit.retryAfterSeconds)
    });
  }

  let resolved;
  try {
    resolved = "token" in parsed.data ? await resolveBackendInvitation(parsed.data.token) : await resolvePublicInvitation(parsed.data.publicSide);
  } catch {
    return privateText("The invitation service is temporarily unavailable.", 503);
  }

  const event = resolved?.events.find((candidate) => candidate.id === eventId);
  if (!event) return privateText("The requested calendar item is unavailable.", 404);

  try {
    const fileName = `${event.id.replace(/[^A-Za-z0-9_-]/g, "") || "wedding-event"}.ics`;
    return privateText(createCalendarEvent(event, parsed.data.locale), 200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`
    });
  } catch {
    return privateText("The invitation service is temporarily unavailable.", 503);
  }
}

export function GET() {
  return privateText("Method not allowed", 405, { Allow: "POST" });
}

export function HEAD() {
  return privateEmpty(405, { Allow: "POST" });
}

export function PUT() {
  return privateText("Method not allowed", 405, { Allow: "POST" });
}

export function PATCH() {
  return privateText("Method not allowed", 405, { Allow: "POST" });
}

export function DELETE() {
  return privateText("Method not allowed", 405, { Allow: "POST" });
}

export function OPTIONS() {
  return privateEmpty(204, { Allow: "POST" });
}
