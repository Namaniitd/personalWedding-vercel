import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";

import { invitationTokenSchema } from "@/lib/rsvp";
import { resolveBackendInvitation } from "@/lib/server/backend-client";
import { privateMediaFiles } from "@/lib/server/private-media";
import { privateBinary, privateText } from "@/lib/server/private-response";
import { takeRateLimit } from "@/lib/server/rate-limit";
import { clientNetworkIdentifier } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MediaContext = { params: Promise<{ token: string; asset: string }> };

export async function GET(request: NextRequest, { params }: MediaContext) {
  const { token, asset } = await params;
  if (!invitationTokenSchema.safeParse(token).success || !Object.hasOwn(privateMediaFiles, asset)) {
    return privateText("This media is unavailable.", 404);
  }
  const limit = await takeRateLimit(`invitation-media:network:${clientNetworkIdentifier(request)}`, 240);
  if (!limit.allowed) return privateText("Please wait a minute before trying again.", 429, { "Retry-After": String(limit.retryAfterSeconds) });

  try {
    if (!await resolveBackendInvitation(token)) return privateText("This media is unavailable.", 404);
  } catch {
    return privateText("This media is temporarily unavailable.", 503);
  }
  try {
    const relativePath = privateMediaFiles[asset as keyof typeof privateMediaFiles];
    const bytes = await readFile(join(process.cwd(), "private-media", relativePath));
    return privateBinary(new Uint8Array(bytes).buffer, asset.endsWith(".webp") ? "image/webp" : "image/jpeg");
  } catch {
    return privateText("This media is temporarily unavailable.", 503);
  }
}

export async function HEAD(request: NextRequest, context: MediaContext) {
  const response = await GET(request, context);
  return new NextResponse(null, { status: response.status, headers: response.headers });
}
