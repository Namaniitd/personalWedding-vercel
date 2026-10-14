import { z } from "zod";

/**
 * Versioned, non-URL QR payload for the venue scanner. A custom payload avoids
 * handing an invitation bearer URL to the phone camera's browser or another
 * QR application. The actual credential remains an opaque 256-bit token.
 */
export const ENTRY_PASS_QR_PREFIX = "shaadi-entry:v1:";

export const entryPassTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const entryPassPayloadSchema = z.string().regex(
  /^shaadi-entry:v1:[A-Za-z0-9_-]{43}$/
);

export function createEntryPassPayload(token: string) {
  return `${ENTRY_PASS_QR_PREFIX}${token}`;
}

/**
 * Strictly decode scanner text. Do not trim or otherwise normalize it: a QR
 * payload is an exact credential, and accepting variants makes audits harder
 * to reason about.
 */
export function parseEntryPassPayload(payload: string) {
  if (!entryPassPayloadSchema.safeParse(payload).success) return null;
  return payload.slice(ENTRY_PASS_QR_PREFIX.length);
}
