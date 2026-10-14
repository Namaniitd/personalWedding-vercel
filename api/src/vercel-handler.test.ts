import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import handler from "../api/index";

const serviceToken = "a".repeat(48);

describe("Vercel function routing and request boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["https://api.example/healthz", "https://api.example/api/index?__shaadi_route=/healthz"])(
    "serves health checks with the original or rewritten URL: %s", async (url) => {
      const response = await handler.fetch(new Request(url));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(response.headers.get("cache-control")).toContain("no-store");

      const head = await handler.fetch(new Request(url, { method: "HEAD" }));
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
    }
  );

  it("retains service authentication when restoring rewritten API paths", async () => {
    vi.stubEnv("BACKEND_SERVICE_TOKEN", serviceToken);
    const url = "https://api.example/api/index?__shaadi_route=/v1/status";
    const unauthorized = await handler.fetch(new Request(url));
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized." });

    const authorized = await handler.fetch(new Request(url, {
      headers: { "X-Backend-Service-Token": serviceToken }
    }));
    expect(authorized.status).toBe(200);
  });

  it("preserves streamed request bodies and headers through a rewrite", async () => {
    vi.stubEnv("BACKEND_SERVICE_TOKEN", serviceToken);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"token":"too-short"}'));
        controller.close();
      }
    });
    const response = await handler.fetch(new Request(
      "https://api.example/api/index?__shaadi_route=/v1/invitations/resolve",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Backend-Service-Token": serviceToken },
        body: stream,
        duplex: "half"
      } as RequestInit & { duplex: "half" }
    ));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invitation required." });
  });

  it("rejects absent, external, or ambiguous internal route hints", async () => {
    for (const query of ["", "?__shaadi_route=https://other.example/healthz", "?__shaadi_route=/healthz&__shaadi_route=/readyz"]) {
      const response = await handler.fetch(new Request(`https://api.example/api/index${query}`));
      expect(response.status).toBe(404);
    }
  });

  it("dispatches a nested API path using the configured rewrite destination", async () => {
    const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
    const rewrite = config.rewrites.find((rule: { source: string }) => rule.source === "/v1/:path*");
    vi.stubEnv("BACKEND_SERVICE_TOKEN", serviceToken);
    const response = await handler.fetch(new Request(
      new URL(rewrite.destination.replace(":path*", "coordinator/content"), "https://api.example"),
      { method: "PATCH", headers: { "X-Backend-Service-Token": serviceToken } }
    ));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, PUT");
  });
});
