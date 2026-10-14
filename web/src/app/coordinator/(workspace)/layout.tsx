import type { Metadata } from "next";
import type { ReactNode } from "react";

import { CoordinatorShell } from "@/components/coordinator-shell";
import { requireCoordinatorWorkspace } from "@/lib/server/coordinator-access";
import { activeInvitationRows, summariseRows } from "@/lib/coordinator-rows";

export const metadata: Metadata = {
  title: { default: "Coordinator", template: "%s · Coordinator" },
  robots: { index: false, follow: false }
};

export const dynamic = "force-dynamic";

export default async function CoordinatorWorkspaceLayout({ children }: { children: ReactNode }) {
  const { invitations } = await requireCoordinatorWorkspace();
  const totals = summariseRows(activeInvitationRows(invitations));

  return (
    <CoordinatorShell replied={totals.replied} followUps={totals.followUps}>
      {children}
    </CoordinatorShell>
  );
}
