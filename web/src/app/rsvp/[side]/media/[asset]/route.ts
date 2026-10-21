import { NextRequest } from "next/server";
import { invitationMediaResponse } from "@/lib/server/serve-invitation-media";
import { privateEmpty, privateText } from "@/lib/server/private-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type MediaContext = { params: Promise<{ side: string; asset: string }> };

async function mediaResponse(request: NextRequest, { params }: MediaContext, head: boolean) {
  const { side: code, asset } = await params;
  if (code !== "g" && code !== "b") return privateText("This media is unavailable.", 404);
  const side = code === "b" ? "bride" : "groom";
  return invitationMediaResponse(request, { params: Promise.resolve({ token: `public-invitation-${side}`, asset }) }, head, side);
}

export async function GET(request: NextRequest, context: MediaContext) { return mediaResponse(request, context, false); }
export async function HEAD(request: NextRequest, context: MediaContext) {
  const response = await mediaResponse(request, context, true);
  return privateEmpty(response.status, response.headers);
}
