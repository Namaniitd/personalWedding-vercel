import { createHmac, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_STEP_MS = 30_000;

/** Decode an uppercase, unpadded Base32 authenticator key without truncation. */
export function decodeTotpSecret(value: string | undefined) {
  if (!value || !/^[A-Z2-7]{32,103}$/.test(value)) return null;
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of value) {
    accumulator = (accumulator << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 255);
      accumulator &= (1 << bits) - 1;
    }
  }
  // Non-canonical lengths or discarded nonzero bits could hide configuration
  // mistakes. Require at least 160 bits as recommended by RFC 4226.
  if (bytes.length < 20 || bytes.length > 64
    || Math.ceil(bytes.length * 8 / 5) !== value.length || accumulator !== 0) return null;
  return Buffer.from(bytes);
}

function codeForCounter(secret: Buffer, counter: number) {
  const encodedCounter = Buffer.alloc(8);
  encodedCounter.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(encodedCounter).digest();
  const offset = digest[digest.length - 1] & 15;
  const truncated = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(truncated % 1_000_000).padStart(6, "0");
}

/**
 * RFC 6238: SHA-1, six digits, 30-second steps. Return the matched time-step
 * so the login route can consume it once in the shared rate-limit store.
 */
export function matchingTotpCounter(secret: Buffer, code: string | undefined, now = Date.now()) {
  if (!code || !/^\d{6}$/.test(code) || !Number.isSafeInteger(now) || now < 0) return null;
  const currentCounter = Math.floor(now / TOTP_STEP_MS);
  const supplied = Buffer.from(code, "ascii");
  let matched: number | null = null;
  // The adjacent steps tolerate a small clock difference. Compare all three
  // so neither the match position nor an early mismatch changes the work.
  for (const offset of [0, -1, 1]) {
    const counter = currentCounter + offset;
    if (counter < 0) continue;
    const expected = Buffer.from(codeForCounter(secret, counter), "ascii");
    if (timingSafeEqual(supplied, expected) && matched === null) matched = counter;
  }
  return matched;
}
