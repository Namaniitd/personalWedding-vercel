import type { WeddingSide } from "@/lib/types";

export function isWeddingSide(value: unknown): value is WeddingSide {
  return value === "groom" || value === "bride";
}

export function weddingSideCode(side: WeddingSide) {
  return side === "bride" ? "b" : "g";
}

export function coordinatorSideFromPath(pathname: string): WeddingSide | null {
  const code = /^\/(?:api\/)?coordinator\/([gb])(?:\/|$)/.exec(pathname)?.[1];
  return code === "b" ? "bride" : code === "g" ? "groom" : null;
}

export function coordinatorPath(side: WeddingSide, suffix = "") {
  return `/coordinator/${weddingSideCode(side)}${suffix ? `/${suffix}` : ""}`;
}

/** Called by client event handlers so an old tab cannot mutate another side. */
export function coordinatorApiPath(action: string, side?: WeddingSide) {
  const currentSide = side ?? (typeof window === "undefined" ? null : coordinatorSideFromPath(window.location.pathname)) ?? "groom";
  return `/api/coordinator/${weddingSideCode(currentSide)}/${action}`;
}

export function invitationPath(side: WeddingSide, token: string) {
  return `/i/${weddingSideCode(side)}/${encodeURIComponent(token)}`;
}
