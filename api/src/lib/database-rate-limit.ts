import { z } from "zod";

import { getDatabasePool } from "./database-rsvps.js";

export const sharedRateLimitSchema = z.object({
  keyHash: z.string().regex(/^[a-f0-9]{64}$/),
  maxRequests: z.number().int().min(1).max(1_000),
  windowMs: z.number().int().min(1_000).max(3_600_000)
}).strict();

export type SharedRateLimitInput = z.infer<typeof sharedRateLimitSchema>;
export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

/** Fail closed when PostgreSQL or the narrowly granted limiter function fails. */
export async function takeDatabaseRateLimit(input: SharedRateLimitInput): Promise<RateLimitResult> {
  const parsed = sharedRateLimitSchema.safeParse(input);
  if (!parsed.success) return { allowed: false, retryAfterSeconds: 60 };
  try {
    // One atomic statement is safe with Neon's transaction pooler: there is no
    // session state, application transaction, or read/update race to preserve.
    const { rows } = await getDatabasePool().query<{
      allowed: boolean;
      retry_after_seconds: number;
    }>("select allowed, retry_after_seconds from wedding.take_rate_limit($1::text, $2::integer, $3::integer)", [
      parsed.data.keyHash, parsed.data.maxRequests, parsed.data.windowMs
    ]);
    const result = rows[0];
    if (rows.length !== 1 || typeof result?.allowed !== "boolean"
      || !Number.isInteger(result.retry_after_seconds)
      || result.retry_after_seconds < (result.allowed ? 0 : 1)
      || result.retry_after_seconds > Math.ceil(parsed.data.windowMs / 1_000)
      || (result.allowed && result.retry_after_seconds !== 0)) {
      return { allowed: false, retryAfterSeconds: 60 };
    }
    return { allowed: result.allowed, retryAfterSeconds: result.retry_after_seconds };
  } catch {
    return { allowed: false, retryAfterSeconds: 60 };
  }
}
