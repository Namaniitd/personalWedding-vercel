import Link from "next/link";
import type { WeddingSide } from "@/lib/types";
import { coordinatorPath } from "@/lib/wedding-side";

export function CoordinatorContentSetup({ side }: { side: WeddingSide }) {
  return (
    <section className="admin-event-totals" aria-labelledby="wedding-setup-title">
      <div className="admin-event-totals-heading">
        <div>
          <p>Wedding setup</p>
          <h2 id="wedding-setup-title">Add your wedding details</h2>
        </div>
        <span>Before creating invite links, save your wedding details, contact, and at least one published event in Content.</span>
        <Link href={coordinatorPath(side, "content")} prefetch={false} className="admin-primary-button">Open Content <b aria-hidden="true">→</b></Link>
      </div>
    </section>
  );
}
