import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WeddingInvite } from "@/components/wedding-invite";
import { resolvePublicInvitation } from "@/lib/server/backend-client";

export { viewport } from "@/app/i/[token]/page";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Naman & Neha | Wedding Invitation",
  description: "Join our wedding celebrations and let us know whether your family can attend.",
  robots: { index: false, follow: false, noarchive: true }
};

export default async function PublicInvitationPage() {
  const resolved = await resolvePublicInvitation("groom").catch(() => null);
  if (!resolved) notFound();
  return <WeddingInvite resolved={resolved} />;
}
