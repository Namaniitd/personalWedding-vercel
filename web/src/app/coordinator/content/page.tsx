import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { coordinatorPath } from "@/lib/wedding-side";
import { CoordinatorContentEditor } from "@/components/coordinator-content-editor";
import { CoordinatorShell } from "@/components/coordinator-shell";
import { activeInvitationRows, summariseRows } from "@/lib/coordinator-rows";
import { requireCoordinatorAccess } from "@/lib/server/coordinator-access";
import { getBackendCoordinatorContent, listBackendCoordinatorInvitations } from "@/lib/server/backend-client";

export const metadata: Metadata = { title: "Invitation content" };
export const dynamic = "force-dynamic";

/**
 * This page intentionally sits outside the normal workspace route group.
 * That group loads guest-ready configuration to build its navigation, while
 * this editor must remain available to bootstrap a fresh database or repair
 * a partially configured one.
 */
export default async function CoordinatorContentPage() {
  const side = await requireCoordinatorAccess();

  const [content, invitations] = await Promise.all([
    getBackendCoordinatorContent(side).catch(() => null),
    // A damaged historic invitation row should not lock a coordinator out of
    // the tool used to repair their actual wedding configuration.
    listBackendCoordinatorInvitations(side).catch(() => [])
  ]);
  if (!content) redirect(coordinatorPath(side, "unavailable"));

  const totals = summariseRows(activeInvitationRows(invitations));
  return (
    <CoordinatorShell side={side} replied={totals.replied} followUps={totals.followUps}>
      <CoordinatorContentEditor initialContent={content} />
    </CoordinatorShell>
  );
}
