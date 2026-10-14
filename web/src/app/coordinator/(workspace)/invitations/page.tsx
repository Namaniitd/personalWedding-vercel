import type { Metadata } from "next";

import { CoordinatorInvitations } from "@/components/coordinator-invitations";
import { requireCoordinatorWorkspace } from "@/lib/server/coordinator-access";

export const metadata: Metadata = { title: "Invite links" };

export default async function CoordinatorInvitationsPage() {
  const { issuerOptions, invitations } = await requireCoordinatorWorkspace();
  return <CoordinatorInvitations issuerOptions={issuerOptions} invitations={invitations} />;
}
