import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";

import { WeddingInvite } from "@/components/wedding-invite";
import { resolveBackendInvitation } from "@/lib/server/backend-client";
import { configuredCanonicalPublicOrigin } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#421021"
};

const shareTitle = "Naman & Neha | Wedding Invitation";
const shareDescription = "Open your personal invitation to view event details and send your reply.";

export function generateMetadata(): Metadata {
  // Messaging apps may preview a bearer invitation URL. Keep every preview
  // generic: no token URL, household name, event, date, or coordinator data.
  // The image URL comes only from the operator's canonical public origin.
  const publicOrigin = configuredCanonicalPublicOrigin();
  const imageUrl = publicOrigin ? new URL("/images/invitation-share.png", publicOrigin).toString() : null;

  return {
    title: shareTitle,
    description: shareDescription,
    robots: { index: false, follow: false, noarchive: true },
    openGraph: {
      type: "website",
      title: shareTitle,
      description: shareDescription,
      siteName: "Wedding Invitation",
      ...(imageUrl ? { images: [{ url: imageUrl, width: 1200, height: 630, alt: "A wedding invitation preview with traditional attire and flowers" }] } : {})
    },
    twitter: {
      card: imageUrl ? "summary_large_image" : "summary",
      title: shareTitle,
      description: shareDescription,
      ...(imageUrl ? { images: [imageUrl] } : {})
    }
  };
}

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // An unavailable data store must not turn a private bearer link into an
  // unhandled error page (or reveal whether the token itself was valid).
  // Treat it exactly like an inactive link and fail closed.
  const invitation = await resolveBackendInvitation(token).catch(() => null);
  if (!invitation) notFound();

  return <WeddingInvite resolved={invitation} />;
}
