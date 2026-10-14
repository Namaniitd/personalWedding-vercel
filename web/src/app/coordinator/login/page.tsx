import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

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
  const databaseConfigured = (await getBackendStatus().catch(() => null))?.coordinatorAvailable ?? false;
  if (databaseConfigured && await isAuthorizedCoordinatorHeaders(await headers())) redirect("/coordinator");

  return <CoordinatorLogin configured={databaseConfigured && isCoordinatorAuthConfigured()} databaseConfigured={databaseConfigured} requiresCode={isCoordinatorTotpRequired()} />;
}
