import { describe, expect, it } from "vitest";

import { MAX_PRIVATE_VIDEO_RANGE_BYTES, privateVideoByteRange } from "./private-media-range";

describe("private video byte ranges", () => {
  it.each([
    ["bytes=2-5", 2, 5],
    ["bytes=7-", 7, 9],
    ["bytes=-4", 6, 9],
    ["bytes=-99", 0, 9],
    ["bytes=0-99", 0, 9],
    ["bytes=0-0", 0, 0],
    ["bytes=9-9", 9, 9],
    ["bytes=0-9999999999999999999999999999", 0, 9],
    ["bytes=-9999999999999999999999999999", 0, 9]
  ])("resolves inclusive, open and suffix ranges: %s", (header, start, end) => {
    expect(privateVideoByteRange(header, 10)).toEqual({ start, end });
  });

  it.each([
    "", "bytes=-", "bytes=-0", "bytes=10-", "bytes=9-3", "bytes=1.5-3",
    "bytes=+1-3", "bytes=0-1,4-5", "items=0-1", "bytes=0--1", "bytes=0-1junk",
    "bytes=9999999999999999999999999999-"
  ])("rejects malformed, multiple and unsatisfiable ranges: %s", (header) => {
    expect(privateVideoByteRange(header, 10)).toBeNull();
  });

  it("bounds every response while keeping the selected starting position", () => {
    const size = 3 * MAX_PRIVATE_VIDEO_RANGE_BYTES;
    expect(privateVideoByteRange("bytes=100-", size)).toEqual({ start: 100, end: 100 + MAX_PRIVATE_VIDEO_RANGE_BYTES - 1 });
    expect(privateVideoByteRange(`bytes=-${2 * MAX_PRIVATE_VIDEO_RANGE_BYTES}`, size))
      .toEqual({ start: MAX_PRIVATE_VIDEO_RANGE_BYTES, end: 2 * MAX_PRIVATE_VIDEO_RANGE_BYTES - 1 });
  });

  it.each([0, -1, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects unusable file lengths: %s", (size) => {
    expect(privateVideoByteRange("bytes=0-", size)).toBeNull();
  });
});
