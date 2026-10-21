import { open, readFile, stat, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest } from "next/server";

import { invitationTokenSchema } from "@/lib/rsvp";
import { resolveBackendInvitation, resolvePublicInvitation } from "@/lib/server/backend-client";
import { privateMediaFiles } from "@/lib/server/private-media";
import { MAX_PRIVATE_VIDEO_FULL_BYTES, privateVideoByteRange } from "@/lib/server/private-media-range";
import { privateBinary, privateEmpty, privateText } from "@/lib/server/private-response";
import { takeRateLimit } from "@/lib/server/rate-limit";
import { clientNetworkIdentifier } from "@/lib/server/request-security";

import type { WeddingSide } from "@/lib/types";

type MediaContext = { params: Promise<{ token: string; asset: string }> };

/** Read only the selected bytes, and close the same file on completion/cancel. */
function videoStream(file: FileHandle, start: number, end: number) {
  let position = start;
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await file.close();
  }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const buffer = new Uint8Array(Math.min(64 * 1024, end - position + 1));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
        if (!bytesRead) throw new Error("The private video ended before its declared length.");
        position += bytesRead;
        controller.enqueue(buffer.subarray(0, bytesRead));
        if (position > end) {
          await close();
          controller.close();
        }
      } catch (error) {
        await close().catch(() => undefined);
        controller.error(error);
      }
    },
    cancel: close
  });
}

export async function invitationMediaResponse(request: NextRequest, { params }: MediaContext, head: boolean, publicSide?: WeddingSide) {
  const { token, asset } = await params;
  if (!invitationTokenSchema.safeParse(token).success || !Object.hasOwn(privateMediaFiles, asset)) {
    return privateText("This media is unavailable.", 404);
  }
  const limit = await takeRateLimit(`invitation-media:network:${clientNetworkIdentifier(request)}`, 240);
  if (!limit.allowed) return privateText("Please wait a minute before trying again.", 429, { "Retry-After": String(limit.retryAfterSeconds) });

  try {
    if (!(publicSide ? await resolvePublicInvitation(publicSide) : await resolveBackendInvitation(token))) return privateText("This media is unavailable.", 404);
  } catch {
    return privateText("This media is temporarily unavailable.", 503);
  }
  try {
    const relativePath = privateMediaFiles[asset as keyof typeof privateMediaFiles];
    const path = join(process.cwd(), "private-media", relativePath);
    const isVideo = asset.endsWith(".mp4");
    const contentType = isVideo ? "video/mp4" : asset.endsWith(".webp") ? "image/webp" : "image/jpeg";

    // Range applies only to GET. HEAD inspects metadata without opening or
    // reading the media body, including for large video replacements.
    if (head) {
      const metadata = await stat(path);
      if (!metadata.isFile() || !Number.isSafeInteger(metadata.size) || metadata.size < 0 || (isVideo && metadata.size === 0)) {
        return privateText("This media is temporarily unavailable.", 503);
      }
      return privateBinary(null, contentType, 200, {
        "Content-Length": String(metadata.size),
        ...(isVideo ? { "Accept-Ranges": "bytes" } : {})
      });
    }
    if (!isVideo) {
      const bytes = await readFile(path);
      return privateBinary(new Uint8Array(bytes).buffer, contentType, 200, { "Content-Length": String(bytes.length) });
    }

    let file: FileHandle | null = await open(path, "r");
    try {
      const metadata = await file.stat();
      if (!metadata.isFile() || !Number.isSafeInteger(metadata.size) || metadata.size <= 0) {
        return privateText("This media is temporarily unavailable.", 503);
      }
      // No validators are issued for these no-store assets, so an If-Range
      // condition cannot match. In that case HTTP requires the full response.
      const rangeHeader = request.headers.has("if-range") ? null : request.headers.get("range");
      const range = rangeHeader === null ? null : privateVideoByteRange(rangeHeader, metadata.size);
      if (rangeHeader !== null && !range) {
        return privateEmpty(416, {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes */${metadata.size}`,
          "Content-Length": "0"
        });
      }
      // Export replacement teasers below 4MiB so clients that request a full
      // GET stay below Vercel's response limit. Larger files still support
      // bounded ranges; never disguise a truncated full file as a 200 response.
      if (!range && metadata.size > MAX_PRIVATE_VIDEO_FULL_BYTES) {
        return privateText("This media is temporarily unavailable.", 503);
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? metadata.size - 1;
      const stream = videoStream(file, start, end);
      file = null; // The stream now owns closing this file, including on cancel.
      return privateBinary(stream, contentType, range ? 206 : 200, {
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${metadata.size}` } : {})
      });
    } finally {
      await file?.close();
    }
  } catch {
    return privateText("This media is temporarily unavailable.", 503);
  }
}

