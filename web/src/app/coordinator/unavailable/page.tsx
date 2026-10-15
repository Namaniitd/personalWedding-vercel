import type { Metadata } from "next";
import { coordinatorPath } from "@/lib/wedding-side";

import { requireCoordinatorAccess } from "@/lib/server/coordinator-access";

export const metadata: Metadata = {
  title: "Coordinator service unavailable",
  robots: { index: false, follow: false }
};

export const dynamic = "force-dynamic";

export default async function CoordinatorUnavailablePage() {
  const side = await requireCoordinatorAccess();

  return (
    <main className="coordinator-login-page">
      <section className="coordinator-login-card" aria-labelledby="coordinator-unavailable-title">
        <div className="coordinator-login-mark" aria-hidden="true">W<span>&amp;</span>W</div>
        <p className="coordinator-login-kicker">Coordinator</p>
        <h1 id="coordinator-unavailable-title">The invitation service needs attention.</h1>
        <p className="coordinator-login-copy">
          Your sign-in is active, but the coordinator workspace could not load. Ask the site administrator to check it, then try again.
        </p>
        <a className="button button-primary coordinator-retry-button" href={coordinatorPath(side)}>Try again</a>
      </section>
    </main>
  );
}
