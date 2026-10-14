import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET, HEAD } from "./route";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), readFile: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/server/backend-client", () => ({ resolveBackendInvitation: mocks.resolve }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("@/lib/server/rate-limit", () => ({ takeRateLimit: mocks.limit }));

const token = "a".repeat(43);
const request = new NextRequest("http://127.0.0.1:3001/i/synthetic/media/image");
function context(asset = "engagement-couple-640.webp", invitationToken = token) {
  return { params: Promise.resolve({ token: invitationToken, asset }) };
}

describe("private invitation media", () => {
  beforeEach(() => {
    mocks.resolve.mockReset().mockResolvedValue({ invitation: { token } });
    mocks.readFile.mockReset().mockResolvedValue(Buffer.from([1, 2, 3]));
    mocks.limit.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
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
  });

  it.each(["../package.json", "../../.env.local", "constructor", "toString", "missing.jpg"])("denies unlisted assets and traversal", async (asset) => {
    expect((await GET(request, context(asset))).status).toBe(404);
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("rejects malformed credentials and fails closed on API outages", async () => {
    expect((await GET(request, context(undefined, "short"))).status).toBe(404);
    mocks.resolve.mockRejectedValueOnce(new Error("unavailable"));
    expect((await GET(request, context())).status).toBe(503);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("limits requests before database or filesystem work", async () => {
    mocks.limit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 20 });
    const response = await GET(request, context());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("20");
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("authenticates HEAD requests and returns no body", async () => {
    const response = await HEAD(request, context("engagementCouplePic.jpg"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(await response.text()).toBe("");
    expect(mocks.resolve).toHaveBeenCalledWith(token);
  });
});
