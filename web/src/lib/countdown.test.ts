import { describe, expect, it } from "vitest";

import { getCountdownParts, hasCountdownElapsed } from "@/lib/countdown";

describe("getCountdownParts", () => {
  it("splits a countdown into days, hours, minutes, and seconds", () => {
    const now = Date.parse("2026-09-03T12:00:00.000Z");
    const target = new Date(now + (2 * 86_400_000) + (4 * 3_600_000) + (5 * 60_000) + 6_000).toISOString();

    expect(getCountdownParts(target, now)).toEqual({ days: 2, hours: 4, minutes: 5, seconds: 6 });
  });

  it("does not show negative time after the wedding moment", () => {
    expect(getCountdownParts("2026-01-01T00:00:00.000Z", Date.parse("2026-01-01T00:00:01.000Z")))
      .toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
    expect(hasCountdownElapsed("2026-01-01T00:00:00.000Z", Date.parse("2026-01-01T00:00:01.000Z"))).toBe(true);
  });

  it("counts down to the same instant when the wedding time includes the IST offset", () => {
    const now = Date.parse("2030-06-01T12:30:00.000Z");
    expect(getCountdownParts("2030-06-02T18:00:00+05:30", now))
      .toEqual({ days: 1, hours: 0, minutes: 0, seconds: 0 });
  });

  it("rolls over at minute and arrival boundaries without celebrating early", () => {
    const target = "2030-06-02T12:30:00.000Z";
    const timestamp = Date.parse(target);
    expect(getCountdownParts(target, timestamp - 60_000))
      .toEqual({ days: 0, hours: 0, minutes: 1, seconds: 0 });
    expect(getCountdownParts(target, timestamp - 59_999))
      .toEqual({ days: 0, hours: 0, minutes: 0, seconds: 59 });
    expect(hasCountdownElapsed(target, timestamp - 1)).toBe(false);
    expect(hasCountdownElapsed(target, timestamp)).toBe(true);
    expect(getCountdownParts(target, timestamp))
      .toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });

  it("rejects an invalid target instead of rendering misleading time", () => {
    expect(getCountdownParts("not-a-date")).toBeNull();
    expect(hasCountdownElapsed("not-a-date")).toBe(false);
  });
});
