import { z } from "zod";

const sessionHash = z.string().regex(/^[a-f0-9]{64}$/);

/** Internal service contract: raw coordinator cookies never leave the frontend. */
export const coordinatorSessionRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("register"), sessionHash, expiresAt: z.string().datetime() }).strict(),
  z.object({ action: z.literal("validate"), sessionHash }).strict(),
  z.object({ action: z.literal("revoke"), sessionHash }).strict()
]);

export type CoordinatorSessionRequest = z.infer<typeof coordinatorSessionRequestSchema>;
