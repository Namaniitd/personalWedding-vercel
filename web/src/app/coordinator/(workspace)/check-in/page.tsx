import type { Metadata } from "next";

import { CheckInScanner } from "@/components/check-in-scanner";
import { requireCoordinatorWorkspace } from "@/lib/server/coordinator-access";

export const metadata: Metadata = { title: "Gate check-in" };

export default async function CoordinatorCheckInPage() {
  const { issuerOptions } = await requireCoordinatorWorkspace();
  return <CheckInScanner events={issuerOptions.events} />;
}
