import { describe, expect, it } from "vitest";

import { GET, HEAD } from "@/app/healthz/route";

describe("health endpoint", () => {
  it("returns a minimal, non-cacheable liveness response", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok\n");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("text/plain");
  });

  it("supports a body-free health probe", async () => {
    const response = HEAD();
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("");
  });
});
