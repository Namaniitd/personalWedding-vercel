import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/backend-client", () => ({ requestBackend: vi.fn() }));

import { requestBackend } from "@/lib/server/backend-client";
import { GET, HEAD } from "@/app/readyz/route";

const mockedRequestBackend = vi.mocked(requestBackend);

describe("frontend readiness", () => {
  beforeEach(() => mockedRequestBackend.mockReset());

  it("requires the authenticated private API readiness response", async () => {
    mockedRequestBackend.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ready\n");
    expect(mockedRequestBackend).toHaveBeenCalledWith("/v1/readyz");
  });

  it("fails closed on private API errors without a response body for HEAD", async () => {
    mockedRequestBackend.mockRejectedValueOnce(new Error("unavailable"));
    const response = await HEAD();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  });
});
