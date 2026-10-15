import { CoordinatorOverview } from "@/components/coordinator-overview";
import { requireCoordinatorWorkspace } from "@/lib/server/coordinator-access";

export default async function CoordinatorOverviewPage() {
  const { invitations, issuerOptions, side } = await requireCoordinatorWorkspace();
  return <CoordinatorOverview side={side} invitations={invitations} issuerOptions={issuerOptions} />;
}
