import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { WeddingSide } from "@/lib/types";
import { coordinatorPath, isWeddingSide } from "@/lib/wedding-side";
import { getBackendCoordinatorWorkspace, getBackendStatus } from "@/lib/server/backend-client";
import { isAuthorizedCoordinatorHeaders } from "@/lib/server/request-security";

export async function requireCoordinatorAccess(): Promise<WeddingSide> {
  const requestHeaders = await headers();
  // Proxy replaces this header from the URL and clears any client copy.
  const configuredSide = requestHeaders.get("x-coordinator-side");
  const side = isWeddingSide(configuredSide) ? configuredSide : "groom";
  if (!await isAuthorizedCoordinatorHeaders(requestHeaders, side)) redirect(coordinatorPath(side, "login"));
  const status = await getBackendStatus().catch(() => null);
  if (status && (!status.coordinatorAvailable || (side === "bride" && !status.sideIsolation))) redirect(coordinatorPath(side, "login"));
  return side;
}

export const loadCoordinatorWorkspace = cache(async (side: WeddingSide = "groom") => {
  const workspace = await getBackendCoordinatorWorkspace(side).catch(() => null);
  if (!workspace) redirect(coordinatorPath(side, "unavailable"));
  return { ...workspace, side };
});

export async function requireCoordinatorWorkspace() {
  return loadCoordinatorWorkspace(await requireCoordinatorAccess());
}
