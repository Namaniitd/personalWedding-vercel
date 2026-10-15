import { z } from "zod";
import { weddingSideSchema } from "./wedding-side.js";

const sessionHash = z.string().regex(/^[a-f0-9]{64}$/);

/** Internal service contract: raw coordinator cookies never leave the frontend. */
export const coordinatorSessionRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("register"), sessionHash, expiresAt: z.string().datetime(), side: weddingSideSchema.default("groom") }).strict(),
  z.object({ action: z.literal("validate"), sessionHash, side: weddingSideSchema.default("groom") }).strict(),
  z.object({ action: z.literal("revoke"), sessionHash, side: weddingSideSchema.default("groom") }).strict()
]);

export type CoordinatorSessionRequest = z.input<typeof coordinatorSessionRequestSchema>;
