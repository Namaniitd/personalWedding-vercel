import type { Metadata } from "next";

import { CoordinatorFollowUps } from "@/components/coordinator-follow-ups";
import { requireCoordinatorWorkspace } from "@/lib/server/coordinator-access";

export const metadata: Metadata = { title: "Follow-ups" };

export default async function CoordinatorFollowUpsPage() {
  const { invitations, issuerOptions } = await requireCoordinatorWorkspace();
  return <CoordinatorFollowUps invitations={invitations} issuerOptions={issuerOptions} />;
}
