import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { coordinatorPath, isWeddingSide } from "@/lib/wedding-side";
import { CoordinatorLogin } from "@/components/coordinator-login";
import { getBackendStatus } from "@/lib/server/backend-client";
import {
  isAuthorizedCoordinatorHeaders,
  isCoordinatorAuthConfigured,
  isCoordinatorTotpRequired
} from "@/lib/server/request-security";

export const metadata: Metadata = {
  title: "Coordinator sign in",
  robots: { index: false, follow: false }
};

export const dynamic = "force-dynamic";

export default async function CoordinatorLoginPage() {
  const requestHeaders = await headers();
  const configuredSide = requestHeaders.get("x-coordinator-side");
  const side = isWeddingSide(configuredSide) ? configuredSide : "groom";
  const status = await getBackendStatus().catch(() => null);
  const databaseConfigured = Boolean(status?.coordinatorAvailable && (side === "groom" || status.sideIsolation));
  if (databaseConfigured && await isAuthorizedCoordinatorHeaders(requestHeaders, side)) redirect(coordinatorPath(side));

  return <CoordinatorLogin side={side} configured={databaseConfigured && isCoordinatorAuthConfigured(side)} databaseConfigured={databaseConfigured} requiresCode={isCoordinatorTotpRequired(side)} />;
}
