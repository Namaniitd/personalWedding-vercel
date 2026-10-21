import { notFound } from "next/navigation";

import { WeddingInvite } from "@/components/wedding-invite";
import { resolvePublicInvitation } from "@/lib/server/backend-client";

export { metadata, viewport } from "@/app/rsvp/g/page";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PublicInvitationPage() {
  const resolved = await resolvePublicInvitation("bride").catch(() => null);
  if (!resolved) notFound();
  return <WeddingInvite resolved={resolved} />;
}
