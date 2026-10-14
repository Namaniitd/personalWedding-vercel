import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import type { NextRequest } from "next/server";

import { isLocalStackPublicOrigin } from "@/lib/server/local-stack";
import { decodeTotpSecret, matchingTotpCounter } from "@/lib/server/coordinator-totp";
import { manageCoordinatorSession } from "@/lib/server/coordinator-session-store";

export const RSVP_BODY_LIMIT_BYTES = 16 * 1024;
export const CALENDAR_BODY_LIMIT_BYTES = 2 * 1024;
export const COORDINATOR_SESSION_COOKIE = "shaadi_coordinator_session";
export const COORDINATOR_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

const MAX_ORIGIN_LENGTH = 2_048;
const MAX_COORDINATOR_PASSWORD_LENGTH = 512;
const MIN_COORDINATOR_PASSWORD_LENGTH = 16;
const MAX_COORDINATOR_SESSION_LENGTH = 256;
// The ALB may shard its Cognito session across four cookies. Keep a generous
// bound for that gateway header while validating our own cookie separately.
const MAX_COOKIE_HEADER_LENGTH = 24 * 1_024;
const COORDINATOR_SESSION_VERSION = "v1";

type PublicAppOriginConfiguration =
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "valid"; origin: string };

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "unsupported_media_type" | "payload_too_large" | "invalid_json" };

function hasJsonContentType(request: Request) {
  const contentType = request.headers.get("content-type");
  return Boolean(contentType && /^application\/json(?:\s*;|$)/i.test(contentType));
}

function declaredLengthIsTooLarge(request: Request, maxBytes: number) {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return false;
  if (!/^\d+$/.test(contentLength)) return true;
  return Number(contentLength) > maxBytes;
}

/**
 * Parse a small JSON request body without first accepting an unbounded upload.
 * `Content-Length` is checked when present and streamed bodies are capped too.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBodyResult> {
  if (!hasJsonContentType(request)) return { ok: false, reason: "unsupported_media_type" };
  if (declaredLengthIsTooLarge(request, maxBytes)) return { ok: false, reason: "payload_too_large" };
  if (!request.body) return { ok: false, reason: "invalid_json" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "payload_too_large" };
      }
      chunks.push(value);
    }

    const body = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }

    try {
      return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) };
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
  } catch {
    return { ok: false, reason: "invalid_json" };
  } finally {
    reader.releaseLock();
  }
}

/**
 * A public deployment must have one explicit, canonical HTTPS origin. Apart
 * from preventing host-header ambiguity at a reverse proxy, this keeps the
 * browser Origin check independent from an internal container hostname.
 */
function parseCanonicalOrigin(value: string, requireHttps = false) {
  if (!value || value.length > MAX_ORIGIN_LENGTH || value.trim() !== value) return null;

  try {
    const parsed = new URL(value);
    if (
      (requireHttps && parsed.protocol !== "https:")
      || parsed.username
      || parsed.password
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash
    ) {
      return null;
    }

    return value === parsed.origin ? parsed.origin : null;
  } catch {
    return null;
  }
}

function publicAppOriginConfiguration(): PublicAppOriginConfiguration {
  const configured = process.env.PUBLIC_APP_ORIGIN;
  if (configured === undefined) return { status: "absent" };

  const origin = parseCanonicalOrigin(configured, process.env.VERCEL === "1" || !isLocalStackPublicOrigin());
  return origin ? { status: "valid", origin } : { status: "invalid" };
}

function isDevelopmentOrTestRuntime() {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

/** True only for the exact canonical HTTPS origin required by a deployment. */
export function hasConfiguredCanonicalPublicOrigin() {
  return publicAppOriginConfiguration().status === "valid";
}

/**
 * Return the operator-configured public origin when it is a valid canonical
 * HTTPS origin. Callers that publish a URL must prefer this over a request
 * origin, which may be an internal host behind a reverse proxy.
 */
export function configuredCanonicalPublicOrigin() {
  const configuration = publicAppOriginConfiguration();
  return configuration.status === "valid" ? configuration.origin : null;
}

/**
 * The base URL used when a coordinator creates a bearer invitation link.
 * Production must never derive this from an internal reverse-proxy request;
 * development and tests can safely use the local request URL when no canonical
 * public origin was configured.
 */
export function invitationPublicOrigin(request: NextRequest) {
  return configuredCanonicalPublicOrigin()
    ?? (isDevelopmentOrTestRuntime() ? requestHostOrigin(request) ?? request.nextUrl.origin : null);
}

function requestOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return origin ? parseCanonicalOrigin(origin) : null;
}

/**
 * In development, Next may normalize `request.nextUrl` to `localhost` even
 * when the browser correctly requested `127.0.0.1`. Build the expected origin
 * from the validated Host header first, so a same-origin local form is not
 * mistaken for a cross-origin request.
 */
function requestHostOrigin(request: NextRequest) {
  const host = request.headers.get("host");
  if (!host || host.length > 512 || /[\s/?#@]/.test(host)) return null;

  try {
    const parsed = new URL(`${request.nextUrl.protocol}//${host}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Guest writes do not use cookies, but this rejects browser cross-site form/fetch
 * submissions as an extra guard around bearer-link actions. Every runtime
 * except explicit development/test uses an explicit public origin instead of
 * the request Host: a standalone container or reverse proxy can otherwise
 * expose an internal hostname to Next.js.
 */
export function isSameOriginRequest(request: NextRequest) {
  const configuration = publicAppOriginConfiguration();

  if (!isDevelopmentOrTestRuntime()) {
    if (configuration.status !== "valid") return false;
    return requestOrigin(request) === configuration.origin;
  }

  // An explicitly supplied but malformed setting is an operator error. Do not
  // make development or staging requests less strict because of it.
  if (configuration.status === "invalid") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  const expectedOrigin = configuration.status === "valid"
    ? configuration.origin
    : requestHostOrigin(request) ?? request.nextUrl.origin;
  const actualOrigin = requestOrigin(request);
  return actualOrigin === expectedOrigin;
}

function coordinatorPassword() {
  const password = process.env.COORDINATOR_PASSWORD;
  if (
    !password
    || password.length < MIN_COORDINATOR_PASSWORD_LENGTH
    || password.length > MAX_COORDINATOR_PASSWORD_LENGTH
    || /[\u0000-\u001f\u007f]/.test(password)
  ) {
    return null;
  }
  return password;
}

/**
 * Database coordinator tools are deliberately unavailable until an operator
 * has supplied a sufficiently long password and session key. Vercel production
 * also requires an authenticator key; supplying a key enables MFA locally too.
 */
export function isCoordinatorAuthConfigured() {
  return coordinatorPassword() !== null && coordinatorSessionSecret() !== null
    && (!isCoordinatorTotpRequired() || coordinatorTotpSecret() !== null);
}

export function isCoordinatorTotpRequired() {
  return (process.env.NODE_ENV === "production" && process.env.VERCEL === "1")
    || Boolean(process.env.COORDINATOR_TOTP_SECRET);
}

function coordinatorTotpSecret() {
  return decodeTotpSecret(process.env.COORDINATOR_TOTP_SECRET);
}

/** No secret or generated code is returned to browser-facing components. */
export function coordinatorTotpCounter(code: string | undefined, now = Date.now()) {
  const secret = coordinatorTotpSecret();
  return secret ? matchingTotpCounter(secret, code, now) : null;
}

/** A non-secret, rotation-specific key for shared one-time-code consumption. */
export function coordinatorTotpReplayIdentifier(counter: number) {
  const secret = coordinatorTotpSecret();
  if (!secret) return null;
  return `coordinator-login:totp:${createHash("sha256").update(secret).digest("base64url")}:${counter}`;
}

/**
 * Compare a submitted local coordinator password without retaining it in a
 * browser credential or exposing it to client-side code.
 */
export function isAuthorizedCoordinatorPassword(candidate: string) {
  const password = coordinatorPassword();
  if (!password || candidate.length > MAX_COORDINATOR_PASSWORD_LENGTH) return false;

  const expected = Buffer.from(password, "utf8");
  const supplied = Buffer.from(candidate, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function coordinatorSessionSecret() {
  const sessionSecret = process.env.COORDINATOR_SESSION_SECRET;
  return sessionSecret && /^[A-Za-z0-9_-]{32,256}$/.test(sessionSecret) ? sessionSecret : null;
}

function coordinatorSessionSigningKey() {
  const password = coordinatorPassword();
  const sessionSecret = coordinatorSessionSecret();
  if (!password || !sessionSecret || !isCoordinatorAuthConfigured()) return null;

  // The frontend has its own session secret and never receives a database
  // pepper. Including the coordinator password invalidates sessions on
  // password rotation without turning a cookie into a password oracle.
  return createHmac("sha256", sessionSecret)
    .update("shaadi-companion:coordinator-session-key:v1\0", "utf8")
    .update(password, "utf8")
    .update("\0", "utf8")
    .update(coordinatorTotpSecret() ?? Buffer.alloc(0))
    .digest();
}

function coordinatorSessionSignature(payload: string, key: Buffer) {
  return createHmac("sha256", key)
    .update(`shaadi-companion:coordinator-session:v1:${payload}`, "utf8")
    .digest("base64url");
}

/** Create an opaque, signed, short-lived coordinator session after sign-in. */
export function createCoordinatorSession(now = Date.now()) {
  const key = coordinatorSessionSigningKey();
  if (!key || !Number.isFinite(now) || now < 0) return null;

  const expiresAt = Math.floor(now / 1_000) + COORDINATOR_SESSION_MAX_AGE_SECONDS;
  const nonce = randomBytes(24).toString("base64url");
  const payload = `${COORDINATOR_SESSION_VERSION}.${expiresAt}.${nonce}`;
  return `${payload}.${coordinatorSessionSignature(payload, key)}`;
}

function coordinatorSessionFromHeaders(headers: Headers) {
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader || cookieHeader.length > MAX_COOKIE_HEADER_LENGTH) return null;

  let value: string | null = null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1 || part.slice(0, separator).trim() !== COORDINATOR_SESSION_COOKIE) continue;
    if (value !== null) return null;
    value = part.slice(separator + 1).trim();
  }
  return value;
}

/** Verify the signature before sending only a digest to the shared store. */
function coordinatorSessionIdentity(value: string | null | undefined, now = Date.now()) {
  if (!value || value.length > MAX_COORDINATOR_SESSION_LENGTH || !Number.isFinite(now) || now < 0) return null;

  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [version, expiresAtText, nonce, signature] = parts;
  if (
    version !== COORDINATOR_SESSION_VERSION
    || !/^[1-9]\d{0,11}$/.test(expiresAtText)
    || !/^[A-Za-z0-9_-]{32}$/.test(nonce)
    || !/^[A-Za-z0-9_-]{43}$/.test(signature)
  ) return null;

  const expiresAt = Number(expiresAtText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1_000)
    || expiresAt > Math.floor(now / 1_000) + COORDINATOR_SESSION_MAX_AGE_SECONDS) return null;

  const key = coordinatorSessionSigningKey();
  if (!key) return null;
  const payload = `${version}.${expiresAtText}.${nonce}`;
  const expected = Buffer.from(coordinatorSessionSignature(payload, key), "utf8");
  const supplied = Buffer.from(signature, "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  return { sessionHash: createHash("sha256").update(value).digest("hex"), expiresAt: new Date(expiresAt * 1_000).toISOString() };
}

/** Register before issuing a cookie; unsigned or unregistered cookies cannot log in. */
export async function registerCoordinatorSession(value: string) {
  const identity = coordinatorSessionIdentity(value);
  return identity ? manageCoordinatorSession({ action: "register", ...identity }) : false;
}

export async function isAuthorizedCoordinatorSession(value: string | null | undefined, now = Date.now()) {
  const identity = coordinatorSessionIdentity(value, now);
  return identity ? manageCoordinatorSession({ action: "validate", sessionHash: identity.sessionHash }) : false;
}

/** Revocation is durable before the browser is told that sign-out succeeded. */
export async function revokeCoordinatorSession(headers: Headers) {
  const identity = coordinatorSessionIdentity(coordinatorSessionFromHeaders(headers));
  return identity ? manageCoordinatorSession({ action: "revoke", sessionHash: identity.sessionHash }) : false;
}

/** Cookie options for the signed coordinator session. */
export function coordinatorSessionCookieOptions(request: NextRequest, maxAge = COORDINATOR_SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "strict" as const,
    // A production request can reach Next over internal HTTP after TLS has
    // terminated at a proxy. The public coordinator session must still be
    // Secure in that deployment.
    secure: process.env.VERCEL === "1" || (!isDevelopmentOrTestRuntime() && !isLocalStackPublicOrigin())
      || request.nextUrl.protocol === "https:"
  };
}

/** Authorize coordinator requests from a signed HttpOnly session cookie. */
export function isAuthorizedCoordinatorHeaders(headers: Headers) {
  return isAuthorizedCoordinatorSession(coordinatorSessionFromHeaders(headers));
}

export function isAuthorizedCoordinatorRequest(request: NextRequest) {
  return isAuthorizedCoordinatorHeaders(request.headers);
}

function normalizeIp(candidate: string | undefined) {
  if (!candidate || candidate.length > 64 || isIP(candidate) === 0) return null;
  return candidate.toLowerCase();
}

function cloudFrontViewerIp(request: NextRequest) {
  const viewerAddress = request.headers.get("cloudfront-viewer-address")?.trim();
  if (!viewerAddress || viewerAddress.length > 128) return null;

  // CloudFront sends the viewer source address as "IP:port". Accept bracketed
  // and unbracketed IPv6 defensively, then validate the IP and port separately.
  const bracketed = /^\[([^\]]+)\]:(\d{1,5})$/.exec(viewerAddress);
  const separator = viewerAddress.lastIndexOf(":");
  const address = bracketed?.[1] ?? (separator > 0 ? viewerAddress.slice(0, separator) : "");
  const port = bracketed?.[2] ?? (separator > 0 ? viewerAddress.slice(separator + 1) : "");
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65_535) return null;
  return normalizeIp(address);
}

/**
 * Network key for the shared limiter. Vercel overwrites its own forwarded-IP
 * header; an absent/invalid one uses a shared bucket, never a client-supplied
 * CloudFront header. Behind an
 * origin-locked CloudFront distribution, prefer its generated viewer-address
 * header because CloudFront appends (rather than replaces) X-Forwarded-For.
 * Other deployments must overwrite X-Forwarded-For. Token-scoped limiting
 * is always applied too.
 */
export function clientNetworkIdentifier(request: NextRequest) {
  if (process.env.VERCEL === "1") {
    return normalizeIp(request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()) ?? "unknown";
  }
  return cloudFrontViewerIp(request)
    ?? normalizeIp(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim())
    ?? "unknown";
}

/**
 * Rate-limit buckets are process state. Derive a non-secret identifier before
 * giving a private bearer credential to that layer, even though the limiter
 * hashes its final composite key again before storing it.
 */
export function bearerTokenRateLimitDigest(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}
