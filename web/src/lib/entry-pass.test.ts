import { describe, expect, it } from "vitest";

import {
  ENTRY_PASS_QR_PREFIX,
  createEntryPassPayload,
  entryPassPayloadSchema,
  parseEntryPassPayload
} from "@/lib/entry-pass";

const token = "qB0sFD3J5xP8cK9mN2vW4yZ6aC7dE1fG3hI5jL7oR9s";

describe("entry-pass payload", () => {
  it("wraps and parses only the versioned opaque 256-bit credential", () => {
    const payload = createEntryPassPayload(token);
    expect(payload).toBe(`${ENTRY_PASS_QR_PREFIX}${token}`);
    expect(entryPassPayloadSchema.safeParse(payload).success).toBe(true);
    expect(parseEntryPassPayload(payload)).toBe(token);
  });

  it("does not accept URLs, invitation-looking values, whitespace, or an incorrect version", () => {
    expect(parseEntryPassPayload(`https://example.test/i/${token}`)).toBeNull();
    expect(parseEntryPassPayload(`shaadi-entry:v2:${token}`)).toBeNull();
    expect(parseEntryPassPayload(` ${createEntryPassPayload(token)}`)).toBeNull();
    expect(parseEntryPassPayload(`${ENTRY_PASS_QR_PREFIX}too-short`)).toBeNull();
  });
});
