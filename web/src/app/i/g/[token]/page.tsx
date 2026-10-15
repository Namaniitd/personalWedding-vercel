import { notFound } from "next/navigation";
import { WeddingInvite } from "@/components/wedding-invite";
import { resolveBackendInvitation } from "@/lib/server/backend-client";

export { generateMetadata, viewport } from "@/app/i/[token]/page";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invitation = await resolveBackendInvitation(token, "groom").catch(() => null);
  if (!invitation) notFound();
  return <WeddingInvite resolved={invitation} />;
}
