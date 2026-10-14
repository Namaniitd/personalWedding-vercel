import { createHash } from "node:crypto";

import { takeDatabaseRateLimit } from "./database-rate-limit.js";

const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 10_000;

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

function bucketKey(identifier: string, maxRequests: number, windowMs: number) {
  // Keep bearer tokens and arbitrary request headers out of process memory as
  // plaintext, and cap the amount of work an oversized header can cause.
  return createHash("sha256")
    .update(`shaadi:rate-limit:v1:${maxRequests}:${windowMs}:`)
    .update(identifier.slice(0, 512)).digest("hex");
}

function makeRoom(now: number) {
  if (buckets.size < MAX_BUCKETS) return;

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }

  if (buckets.size >= MAX_BUCKETS) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey) buckets.delete(oldestKey);
  }
}

/**
 * Vercel functions share atomic PostgreSQL counters. Local development and
 * existing single-process deployments retain the bounded in-memory fallback.
 */
export async function takeRateLimit(identifier: string, maxRequests = 8, windowMs = 60_000): Promise<RateLimitResult> {
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 1_000
    || !Number.isInteger(windowMs) || windowMs < 1_000 || windowMs > 3_600_000) {
    return { allowed: false, retryAfterSeconds: 60 };
  }
  const key = bucketKey(identifier, maxRequests, windowMs);
  if (process.env.VERCEL === "1") {
    return takeDatabaseRateLimit({ keyHash: key, maxRequests, windowMs });
  }
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    makeRoom(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    };
  }
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

// Retained as a small convenience for callers that only need a boolean.
export async function allowSubmission(identifier: string, maxRequests = 8, windowMs = 60_000) {
  return (await takeRateLimit(identifier, maxRequests, windowMs)).allowed;
}

// Kept out of application routes; it lets deterministic unit tests isolate buckets.
export function resetRateLimitsForTest() {
  buckets.clear();
}
