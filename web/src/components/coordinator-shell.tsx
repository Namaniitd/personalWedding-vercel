"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { WeddingSide } from "@/lib/types";
import { coordinatorApiPath, coordinatorPath } from "@/lib/wedding-side";

type NavItem = {
  href: string;
  label: string;
  badge?: {
    count: number;
    label: string;
  };
};

export function CoordinatorShell({
  side = "groom",
  replied,
  followUps,
  children
}: {
  side?: WeddingSide;
  replied: number;
  followUps: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const navigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const navigation = navigationRef.current;
    const active = navigation?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!navigation || !active) return;

    // The mobile navigation scrolls horizontally. Reveal the selected route
    // after direct loads and client navigation without moving the page itself.
    const frame = window.requestAnimationFrame(() => {
      const navigationBounds = navigation.getBoundingClientRect();
      const activeBounds = active.getBoundingClientRect();
      const inset = 8;
      if (activeBounds.left < navigationBounds.left + inset) {
        navigation.scrollLeft -= navigationBounds.left + inset - activeBounds.left;
      } else if (activeBounds.right > navigationBounds.right - inset) {
        navigation.scrollLeft += activeBounds.right - navigationBounds.right + inset;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  const navItems: NavItem[] = [
    { href: "/coordinator", label: "Overview" },
    { href: "/coordinator/content", label: "Content" },
    { href: "/coordinator/check-in", label: "Gate check-in" },
    { href: "/coordinator/invitations", label: "Invite links" },
    { href: "/coordinator/responses", label: "Responses", badge: { count: replied, label: "household replies received" } },
    { href: "/coordinator/follow-ups", label: "Follow-ups", badge: { count: followUps, label: "households need follow-up" } }
  ].map((item) => ({ ...item, href: coordinatorPath(side, item.href.slice("/coordinator".length).replace(/^\//, "")) }));

  async function signOut() {
    if (isSigningOut) return;

    setIsSigningOut(true);
    setSignOutError("");
    try {
      const response = await fetch(coordinatorApiPath("logout", side), {
        method: "POST",
        credentials: "same-origin"
      });
      if (!response.ok || response.redirected) {
        setSignOutError("Coordinator sign-out could not be completed. Please try again.");
        return;
      }
      if (response.status === 204) {
        // Discard the authenticated client router state along with the cookie.
        window.location.replace(coordinatorPath(side, "login"));
        return;
      }
      if (response.status !== 200 || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        setSignOutError("Coordinator sign-out could not be completed. Please try again.");
        return;
      }
      const result: unknown = await response.json().catch(() => null);
      if (!result || typeof result !== "object" || !("logoutUrl" in result) || typeof result.logoutUrl !== "string") {
        setSignOutError("Coordinator sign-out could not be completed. Please try again.");
        return;
      }
      window.location.assign(result.logoutUrl);
    } catch {
      setSignOutError("Coordinator sign-out could not be completed. Please try again.");
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <main className="admin-page">
      <a className="admin-skip-link" href="#coordinator-main">Skip to main content</a>
      <header className="admin-header">
        <Link href="/" prefetch={false} className="admin-brand" aria-label="Private invitation home">
          <span className="admin-brand-mark" aria-hidden="true">W<span>&amp;</span>W</span>
          <span className="admin-brand-copy">Private invitation <small>{side === "bride" ? "Bride’s coordinator" : "Groom’s coordinator"}</small></span>
        </Link>
        <nav ref={navigationRef} className="admin-navigation" aria-label="Coordinator workspace">
          {navItems.map((item) => {
            // Only "/coordinator" needs an exact match; the rest are leaf routes.
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                className={isActive ? "is-active" : ""}
                aria-current={isActive ? "page" : undefined}
                aria-label={item.badge ? `${item.label}: ${item.badge.count} ${item.badge.label}` : undefined}
              >
                {item.label}
                {item.badge === undefined ? null : <span aria-hidden="true">{item.badge.count}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="admin-header-actions">
          <span className="admin-database-pill"><span aria-hidden="true" /> {side === "bride" ? "Bride’s workspace" : "Groom’s workspace"}</span>
          <button type="button" className="admin-sign-out-button" onClick={() => void signOut()} disabled={isSigningOut}>
            {isSigningOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </header>
      {signOutError ? <p className="admin-live-notice" role="alert">{signOutError}</p> : null}

      <div id="coordinator-main" className="admin-main">{children}</div>
    </main>
  );
}
