import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET, HEAD } from "./route";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(), privateResolve: vi.fn(), limit: vi.fn(),
  open: vi.fn(), read: vi.fn(), close: vi.fn(), stat: vi.fn()
}));
vi.mock("@/lib/server/backend-client", () => ({ resolvePublicInvitation: mocks.resolve, resolveBackendInvitation: mocks.privateResolve }));
vi.mock("@/lib/server/rate-limit", () => ({ takeRateLimit: mocks.limit }));
vi.mock("node:fs/promises", () => ({ open: mocks.open, stat: mocks.stat, readFile: vi.fn() }));

const audioBytes = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);
const request = new NextRequest("http://127.0.0.1:3000/rsvp/g/media/raabta-instrumental.m4a", { headers: { Range: "bytes=2-5" } });
function context(side = "g", asset = "raabta-instrumental.m4a") { return { params: Promise.resolve({ side, asset }) }; }

describe("public invitation audio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve.mockReset().mockResolvedValue({ invitation: { kind: "public" } });
    mocks.limit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.close.mockResolvedValue(undefined);
    mocks.stat.mockResolvedValue({ isFile: () => true, size: audioBytes.length });
    mocks.read.mockImplementation(async (buffer: Uint8Array, offset: number, length: number, position: number) => {
      const bytesRead = Math.min(length, audioBytes.length - position);
      buffer.set(audioBytes.subarray(position, position + bytesRead), offset);
      return { bytesRead };
    });
    mocks.open.mockResolvedValue({ stat: mocks.stat, read: mocks.read, close: mocks.close });
  });

  it.each([["g", "groom"], ["b", "bride"]])("serves seekable audio only through the configured %s invitation", async (code, side) => {
    const response = await GET(request, context(code));
    expect(response.status).toBe(206);
    expect(mocks.resolve).toHaveBeenCalledWith(side);
    expect(mocks.privateResolve).not.toHaveBeenCalled();
    expect(mocks.open.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.resolve.mock.invocationCallOrder[0]!);
    expect(response.headers.get("content-type")).toBe("audio/mp4");
    expect(response.headers.get("content-range")).toBe("bytes 2-5/8");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(audioBytes.subarray(2, 6));
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("returns audio metadata without streaming a body for HEAD", async () => {
    const response = await HEAD(request, context());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mp4");
    expect(response.headers.get("content-length")).toBe("8");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(await response.text()).toBe("");
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("denies an unavailable public invitation before reading its recording", async () => {
    mocks.resolve.mockResolvedValue(null);
    expect((await GET(request, context())).status).toBe(404);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.stat).not.toHaveBeenCalled();
  });

  it("rejects unknown sides and unlisted audio files", async () => {
    expect((await GET(request, context("unknown"))).status).toBe(404);
    expect((await GET(request, context("g", "../../.env.local"))).status).toBe(404);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
