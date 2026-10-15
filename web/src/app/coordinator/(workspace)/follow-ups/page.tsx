import type { Metadata } from "next";

import { CoordinatorFollowUps } from "@/components/coordinator-follow-ups";
import { requireCoordinatorWorkspace } from "@/lib/server/coordinator-access";

export const metadata: Metadata = { title: "Follow-ups" };

export default async function CoordinatorFollowUpsPage() {
  const { invitations, issuerOptions, side } = await requireCoordinatorWorkspace();
  return <CoordinatorFollowUps side={side} invitations={invitations} issuerOptions={issuerOptions} />;
}
