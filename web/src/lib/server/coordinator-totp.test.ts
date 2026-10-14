import { describe, expect, it } from "vitest";

import { decodeTotpSecret, matchingTotpCounter } from "./coordinator-totp";

// RFC 6238 Appendix B uses the ASCII key "12345678901234567890" and
// eight digits. Its published SHA-1 results reduce to these six-digit codes.
const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("coordinator authenticator verification", () => {
  it.each([
    [59, "287082"],
    [1_111_111_109, "081804"],
    [1_111_111_111, "050471"],
    [1_234_567_890, "005924"],
    [2_000_000_000, "279037"],
    [20_000_000_000, "353130"]
  ])("matches RFC 6238 SHA-1 vector at time %s", (seconds, code) => {
    const secret = decodeTotpSecret(rfcSecret);
    expect(secret?.toString("ascii")).toBe("12345678901234567890");
    if (!secret) throw new Error("Expected the RFC key to decode.");
    expect(matchingTotpCounter(secret, code, seconds * 1_000)).toBe(Math.floor(seconds / 30));
  });

  it("accepts only the current step and one neighboring step on each side", () => {
    const secret = decodeTotpSecret(rfcSecret)!;
    expect(matchingTotpCounter(secret, "287082", 59_000)).toBe(1);
    expect(matchingTotpCounter(secret, "287082", 29_000)).toBe(1);
    expect(matchingTotpCounter(secret, "287082", 89_000)).toBe(1);
    expect(matchingTotpCounter(secret, "287082", 90_000)).toBeNull();
    expect(matchingTotpCounter(secret, "287082", 120_000)).toBeNull();
    expect(matchingTotpCounter(secret, "287082", -1)).toBeNull();
    expect(matchingTotpCounter(secret, "287082", Number.NaN)).toBeNull();
  });

  it.each([undefined, "", "28708", "2870820", " 287082", "287082 ", "abcdef", "２８７０８２"])(
    "rejects malformed codes %s", (code) => {
      expect(matchingTotpCounter(decodeTotpSecret(rfcSecret)!, code, 59_000)).toBeNull();
    }
  );

  it("rejects malformed, short, non-canonical, or oversized keys", () => {
    for (const value of [undefined, "", "JBSWY3DPEHPK3PXP", rfcSecret.toLowerCase(),
      `${rfcSecret}=`, `${rfcSecret}A`, `${rfcSecret}AB`, "A".repeat(104), "A".repeat(31)]) {
      expect(decodeTotpSecret(value)).toBeNull();
    }
    expect(decodeTotpSecret("A".repeat(52))?.length).toBe(32);
    expect(decodeTotpSecret("A".repeat(103))?.length).toBe(64);
  });
});
