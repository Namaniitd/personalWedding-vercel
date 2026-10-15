import { z } from "zod";

import type { WeddingSide } from "./types.js";

/** Ownership is independent of the invitation's selected reply-to contact. */
export const weddingSideSchema = z.enum(["groom", "bride"]);

export function requireWeddingSide(value: unknown): WeddingSide {
  return weddingSideSchema.parse(value);
}

export function weddingSideSettingsId(side: WeddingSide) {
  return requireWeddingSide(side) === "groom" ? 1 : 2;
}

export function weddingSidePath(side: WeddingSide) {
  return requireWeddingSide(side) === "groom" ? "g" : "b";
}
