import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET, HEAD } from "./route";
import { MAX_PRIVATE_VIDEO_FULL_BYTES, MAX_PRIVATE_VIDEO_RANGE_BYTES } from "@/lib/server/private-media-range";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(), readFile: vi.fn(), limit: vi.fn(),
  open: vi.fn(), stat: vi.fn(), fileStat: vi.fn(), read: vi.fn(), close: vi.fn()
}));
vi.mock("@/lib/server/backend-client", () => ({ resolveBackendInvitation: mocks.resolve }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile, open: mocks.open, stat: mocks.stat }));
vi.mock("@/lib/server/rate-limit", () => ({ takeRateLimit: mocks.limit }));

const token = "a".repeat(43);
const request = new NextRequest("http://127.0.0.1:3001/i/synthetic/media/image");
const video = "prewedding-teaser-hd.mp4";
let videoBytes: Buffer;
function rangeRequest(range: string) {
  return new NextRequest(request.url, { headers: { Range: range } });
}
function context(asset = "engagement-couple-640.webp", invitationToken = token) {
  return { params: Promise.resolve({ token: invitationToken, asset }) };
}

describe("private invitation media", () => {
  beforeEach(() => {
    mocks.resolve.mockReset().mockResolvedValue({ invitation: { token } });
    mocks.readFile.mockReset().mockResolvedValue(Buffer.from([1, 2, 3]));
    mocks.limit.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    videoBytes = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    mocks.stat.mockReset().mockResolvedValue({ size: 3, isFile: () => true });
    mocks.fileStat.mockReset().mockImplementation(async () => ({ size: videoBytes.length, isFile: () => true }));
    mocks.close.mockReset().mockResolvedValue(undefined);
    mocks.read.mockReset().mockImplementation(async (buffer: Uint8Array, offset: number, length: number, position: number) => {
      const bytesRead = Math.min(length, videoBytes.length - position);
      buffer.set(videoBytes.subarray(position, position + bytesRead), offset);
      return { buffer, bytesRead };
    });
    mocks.open.mockReset().mockResolvedValue({ stat: mocks.fileStat, read: mocks.read, close: mocks.close });
  });

  it("serves bytes only after invitation verification, with private response headers", async () => {
    const response = await GET(request, context());
    expect(response.status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledWith(token);
    expect(mocks.readFile.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.resolve.mock.invocationCallOrder[0]!);
    expect(mocks.readFile.mock.calls[0]?.[0]).toMatch(/private-media[/\\]engagement-couple-640.webp$/);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("denies inactive, expired, or revoked invitations without reading any file", async () => {
    mocks.resolve.mockResolvedValue(null);
    expect((await GET(request, context())).status).toBe(404);
    expect((await HEAD(request, context())).status).toBe(404);
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.stat).not.toHaveBeenCalled();
  });

  it.each(["../package.json", "../../.env.local", "constructor", "toString", "missing.jpg", "prewedding-teaser.mp4", "comingSoon4K.mp4", "comingSoonHD.mp4"])("denies unlisted assets and traversal", async (asset) => {
    expect((await GET(request, context(asset))).status).toBe(404);
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("rejects malformed credentials and fails closed on API outages", async () => {
    expect((await GET(request, context(undefined, "short"))).status).toBe(404);
    mocks.resolve.mockRejectedValueOnce(new Error("unavailable"));
    expect((await GET(request, context())).status).toBe(503);
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("limits requests before database or filesystem work", async () => {
    mocks.limit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 20 });
    const response = await GET(request, context());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("20");
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.stat).not.toHaveBeenCalled();
  });

  it("authenticates HEAD requests and returns no body", async () => {
    const response = await HEAD(request, context("engagementCouplePic.jpg"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(await response.text()).toBe("");
    expect(mocks.resolve).toHaveBeenCalledWith(token);
    expect(response.headers.get("content-length")).toBe("3");
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.stat.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.resolve.mock.invocationCallOrder[0]!);
  });

  it("serves the allowlisted teaser poster under the invitation gate", async () => {
    const response = await GET(request, context("prewedding-teaser-poster.webp"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(mocks.readFile.mock.calls[0]?.[0]).toMatch(/private-media[/\\]prewedding-teaser-poster.webp$/);
    await response.arrayBuffer();
  });

  it("streams a complete small video with accurate private headers and closes its file", async () => {
    const response = await GET(request, context(video));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-range")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(mocks.open.mock.calls[0]?.[0]).toMatch(/private-media[/\\]teaser[/\\]prewedding-teaser-hd.mp4$/);
    expect(mocks.open.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.resolve.mock.invocationCallOrder[0]!);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(videoBytes);
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it.each([
    ["bytes=2-5", 2, 5], ["bytes=7-", 7, 9], ["bytes=-4", 6, 9],
    ["bytes=0-99", 0, 9], ["bytes=-99", 0, 9], ["bytes=0-0", 0, 0]
  ])("streams exactly the selected bytes for %s", async (header, start, end) => {
    const response = await GET(rangeRequest(header), context(video));
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes ${start}-${end}/10`);
    expect(response.headers.get("content-length")).toBe(String(end - start + 1));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(videoBytes.subarray(start, end + 1));
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("caps a broad range at one MiB and reads the selected part in bounded chunks", async () => {
    videoBytes = Buffer.alloc(3 * MAX_PRIVATE_VIDEO_RANGE_BYTES, 9);
    const response = await GET(rangeRequest("bytes=100-"), context(video));
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 100-${100 + MAX_PRIVATE_VIDEO_RANGE_BYTES - 1}/${videoBytes.length}`);
    expect((await response.arrayBuffer()).byteLength).toBe(MAX_PRIVATE_VIDEO_RANGE_BYTES);
    expect(mocks.read.mock.calls.every(([, offset, length, position]) => offset === 0 && length <= 64 * 1024 && position >= 100 && position + length <= 100 + MAX_PRIVATE_VIDEO_RANGE_BYTES)).toBe(true);
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it.each(["bytes=10-", "bytes=9-3", "bytes=-0", "bytes=0-1,4-5", "bytes=invalid", "items=0-1"])("returns a private bodyless416 for %s", async (header) => {
    const response = await GET(rangeRequest(header), context(video));
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
    expect(response.headers.get("content-length")).toBe("0");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toBe("");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("denies a revoked invitation before opening a video or evaluating its range", async () => {
    mocks.resolve.mockResolvedValue(null);
    const response = await GET(rangeRequest("bytes=0-1"), context(video));
    expect(response.status).toBe(404);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("ignores Range on HEAD and returns complete video metadata without body reads", async () => {
    mocks.stat.mockResolvedValue({ size: MAX_PRIVATE_VIDEO_FULL_BYTES + 1, isFile: () => true });
    const response = await HEAD(rangeRequest("bytes=invalid"), context(video));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-length")).toBe(String(MAX_PRIVATE_VIDEO_FULL_BYTES + 1));
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-range")).toBeNull();
    expect(await response.text()).toBe("");
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("refuses oversized full GETs without truncation while allowing bounded ranges", async () => {
    videoBytes = Buffer.alloc(MAX_PRIVATE_VIDEO_FULL_BYTES + 1);
    expect((await GET(request, context(video))).status).toBe(503);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
    const ranged = await GET(rangeRequest("bytes=0-1"), context(video));
    expect(ranged.status).toBe(206);
    expect((await ranged.arrayBuffer()).byteLength).toBe(2);
  });

  it("falls back to a full response for an unverifiable If-Range condition", async () => {
    const conditional = new NextRequest(request.url, { headers: { Range: "bytes=2-5", "If-Range": '"old-version"' } });
    const response = await GET(conditional, context(video));
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(videoBytes);
  });

  it("fails closed on an empty video without attempting to stream invalid bytes", async () => {
    videoBytes = Buffer.alloc(0);
    mocks.stat.mockResolvedValue({ size: 0, isFile: () => true });
    expect((await GET(request, context(video))).status).toBe(503);
    expect((await HEAD(request, context(video))).status).toBe(503);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("closes an unfinished stream when the client cancels playback", async () => {
    videoBytes = Buffer.alloc(200_000);
    const response = await GET(request, context(video));
    await response.body?.cancel();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("closes the file when metadata or body reads fail", async () => {
    mocks.fileStat.mockRejectedValueOnce(new Error("missing"));
    expect((await GET(request, context(video))).status).toBe(503);
    expect(mocks.close).toHaveBeenCalledOnce();
    mocks.close.mockClear();
    mocks.read.mockRejectedValueOnce(new Error("read failure"));
    const response = await GET(request, context(video));
    await expect(response.arrayBuffer()).rejects.toThrow("read failure");
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
