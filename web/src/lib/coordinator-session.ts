import { z } from "zod";

const side = z.enum(["groom", "bride"]).optional();
const sessionHash = z.string().regex(/^[a-f0-9]{64}$/);

/** Internal service contract: raw coordinator cookies never leave the frontend. */
export const coordinatorSessionRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("register"), sessionHash, side, expiresAt: z.string().datetime() }).strict(),
  z.object({ action: z.literal("validate"), sessionHash, side }).strict(),
  z.object({ action: z.literal("revoke"), sessionHash, side }).strict()
]);

export type CoordinatorSessionRequest = z.infer<typeof coordinatorSessionRequestSchema>;
