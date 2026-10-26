import { invitationMediaUrl } from "@/lib/invitation-media";
import styles from "./wedding-experience.module.css";

import { Mandala } from "./motion-ornaments";

// Original line-work; no artwork is copied from the reference invitation.
export function BotanicalSprig({ className = "" }: { className?: string }) {
  const leaves = [
    [105, 435, -25], [117, 385, 135], [120, 330, -12], [115, 275, 150],
    [110, 225, -30], [119, 177, 150], [138, 130, -15], [158, 88, 158]
  ];
  return <svg className={className} viewBox="0 0 260 500" fill="none" aria-hidden="true">
    <path d="M82 490C145 377 79 275 127 163C148 114 181 71 194 18" stroke="currentColor" strokeWidth="1.25" />
    <path d="M89 484C139 374 88 271 133 166" stroke="currentColor" strokeWidth=".5" />
    {leaves.map(([x, y, turn], index) => <g key={index} transform={`translate(${x} ${y}) rotate(${turn})`}>
      <path d="M0 0C-43-9-75-43-70-92C-28-77 10-42 0 0Z" fill="currentColor" fillOpacity=".09" stroke="currentColor" strokeWidth="1" />
      <path d="M0 0Q-31-39-70-92M-13-18l-29-3m15-13-27-4m14-13-21-5" stroke="currentColor" strokeWidth=".55" />
    </g>)}
    <path d="M194 18C165 24 145 2 159-22C184-15 198 0 194 18Z" stroke="currentColor" />
    <circle cx="94" cy="304" r="4" fill="currentColor" fillOpacity=".35" />
    <circle cx="147" cy="204" r="3" fill="currentColor" fillOpacity=".35" />
  </svg>;
}

export function PalacePortal({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 600 760" fill="none" aria-hidden="true">
    <path d="M48 760V333Q48 214 147 197Q137 131 226 134Q246 75 300 34Q354 75 374 134Q463 131 453 197Q552 214 552 333V760" stroke="currentColor" strokeWidth="1.5" />
    <path d="M68 760V337Q68 230 168 214Q155 151 240 152Q258 100 300 66Q342 100 360 152Q445 151 432 214Q532 230 532 337V760" stroke="currentColor" strokeWidth=".65" />
    <path d="M32 760V328Q32 202 131 183Q128 115 214 116Q237 52 300 10Q363 52 386 116Q472 115 469 183Q568 202 568 328V760M34 725h532M34 740h532" stroke="currentColor" strokeWidth=".5" />
    <path d="m300 16 7 12-7 12-7-12ZM40 338h35m450 0h35M40 352h35m450 0h35" stroke="currentColor" />
    {[98, 502].map((x) => <g key={x}>
      <path d={`M${x} 760V390Q${x} 369 ${x + 12} 356Q${x + 24} 369 ${x + 24} 390V760`} stroke="currentColor" strokeWidth=".5" />
      <path d={`M${x + 6} 760V395Q${x + 6} 380 ${x + 12} 373Q${x + 18} 380 ${x + 18} 395V760`} stroke="currentColor" strokeWidth=".5" />
    </g>)}
  </svg>;
}

export function ScrollScenery({ variant = "botanical", token, photo = "prewedding-banner" }: { variant?: "palace" | "botanical" | "floral"; token: string; photo?: "prewedding-hero" | "prewedding-banner" }) {
  return <div className={styles["scene-backdrop"]} data-variant={variant} aria-hidden="true">
    {variant === "palace" && <picture>
      <source type="image/webp" srcSet={`${invitationMediaUrl(token, `${photo}-960.webp`)} 960w, ${invitationMediaUrl(token, `${photo}-1600.webp`)} 1600w`} sizes="100vw" />
      <img className={styles["scenery-photo"]} src={invitationMediaUrl(token, `${photo}-1600.webp`)} loading="lazy" alt="" width={1600} height={1066} decoding="async" />
    </picture>}
    <div className={styles["scenery-veil"]} />
    <div className={styles["scenery-mandala"]}><Mandala /></div>
    <BotanicalSprig className={styles["scenery-sprig"] + " " + styles["scenery-sprig-left"]} />
    <BotanicalSprig className={styles["scenery-sprig"] + " " + styles["scenery-sprig-right"]} />
    {variant === "palace" && <PalacePortal className={styles["scenery-portal"]} />}
    <div className={styles["scenery-grain"]} />
  </div>;
}
