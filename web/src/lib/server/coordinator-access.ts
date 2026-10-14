import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getBackendCoordinatorWorkspace, getBackendStatus } from "@/lib/server/backend-client";
import { isAuthorizedCoordinatorHeaders } from "@/lib/server/request-security";

/**
 * Every coordinator route repeats the same gate, so keep it in one place: the
 * workspace is database-backed and behind the signed coordinator session.
 */
export async function requireCoordinatorAccess() {
  const requestHeaders = await headers();
  if (!await isAuthorizedCoordinatorHeaders(requestHeaders)) redirect("/coordinator/login");
  const status = await getBackendStatus().catch(() => null);
  if (status && !status.coordinatorAvailable) redirect("/coordinator/login");
}

/**
 * `cache` keeps the layout and its page from issuing the same queries twice
 * while rendering a single request.
 */
export const loadCoordinatorWorkspace = cache(async () => {
  // A connection failure is actionable for a signed-in coordinator. Do not
  // send them to the guest invitation 404, which incorrectly implies that a
  // bearer link was revoked or expired.
  const workspace = await getBackendCoordinatorWorkspace().catch(() => null);
  if (!workspace) redirect("/coordinator/unavailable");
  return workspace;
});

export async function requireCoordinatorWorkspace() {
  await requireCoordinatorAccess();
  return loadCoordinatorWorkspace();
}
