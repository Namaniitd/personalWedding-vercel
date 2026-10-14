import { CoordinatorOverview } from "@/components/coordinator-overview";
import { requireCoordinatorWorkspace } from "@/lib/server/coordinator-access";

export default async function CoordinatorOverviewPage() {
  const { invitations, issuerOptions } = await requireCoordinatorWorkspace();
  return <CoordinatorOverview invitations={invitations} issuerOptions={issuerOptions} />;
}
