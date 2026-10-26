import { invitationMediaUrl } from "@/lib/invitation-media";
import type { Locale, LocalizedText, WeddingEvent } from "@/lib/types";

import { BotanicalSprig, PalacePortal } from "./scroll-scenery";
import styles from "./wedding-experience.module.css";

const images: Record<WeddingEvent["category"], string> = {
  celebration: "prewedding-celebration",
  ceremony: "prewedding-ceremony",
  reception: "prewedding-reception"
};

/** Only the events already resolved for this invitation become story chapters. */
export function ScrollStory({ locale, couple, events, token }: {
  locale: Locale;
  couple: LocalizedText;
  events: WeddingEvent[];
  token: string;
}) {
  if (!events.length) return null;

  return <section className={styles["scroll-story"]} id="celebration-story" data-scroll-scene data-scroll-story data-single-chapter={events.length === 1 || undefined} aria-labelledby="story-title">
    <h2 id="story-title" className={styles["scene-sr-only"]}>{locale === "hi" ? "मिलकर बनाएँ खूबसूरत यादें" : "A celebration to remember"}</h2>
    <div className={styles["story-stage"]} data-story-stage>
      <div className={styles["story-images"]} aria-hidden="true">
        {events.map((event, index) => <picture key={event.id}>
          <source type="image/webp" srcSet={`${invitationMediaUrl(token, `${images[event.category]}-960.webp`)} 960w, ${invitationMediaUrl(token, `${images[event.category]}-1600.webp`)} 1600w`} sizes="100vw" />
          <img className={`${styles["story-image"]} ${index === 0 ? styles["story-image-first"] : ""}`} data-story-image data-photo={event.category} src={invitationMediaUrl(token, `${images[event.category]}-1600.webp`)} alt="" width={1600} height={1066} loading="lazy" decoding="async" />
        </picture>)}
      </div>
      <div className={styles["story-veil"]} aria-hidden="true" />
      <PalacePortal className={styles["story-portal"]} />
      <BotanicalSprig className={`${styles["story-sprig"]} ${styles["story-sprig-left"]}`} />
      <BotanicalSprig className={`${styles["story-sprig"]} ${styles["story-sprig-right"]}`} />
      <div className={styles["story-topline"]}><span>{couple[locale]}</span><span>{locale === "hi" ? "हमारे साथ यादें बनाएँ ↓" : "LET THE STORY UNFOLD ↓"}</span></div>
      <div className={styles["story-captions"]}>
        {events.map((event, index) => <div className={styles["story-caption"]} data-story-caption={index} key={event.id}>
          <p className={styles["story-eyebrow"]}>{String(index + 1).padStart(2, "0")} <span aria-hidden="true">/</span> {locale === "hi" ? "हमारे साथ उत्सव मनाएँ" : "Celebrate with us"}</p>
          <h3>{event.title[locale]}</h3>
          <p className={styles["story-description"]}>{event.venue[locale]}</p>
          <p className={styles["story-date"]}>{event.date[locale]} · {event.startTime[locale]}</p>
        </div>)}
      </div>
      <div className={styles["story-bottomline"]}>
        <ol className={styles["story-chapters"]} aria-label={locale === "hi" ? "हमारे समारोह" : "The celebrations"}>
          {events.map((event, index) => <li className={styles["story-chapter"]} data-story-chapter key={event.id}>
            <span className={styles["story-chapter-track"]} aria-hidden="true"><i /></span>
            <span><b>{String(index + 1).padStart(2, "0")}</b><span>{event.title[locale]}</span></span>
          </li>)}
        </ol>
        <a className={styles["story-details"]} href="#schedule">{locale === "hi" ? "समारोहों की जानकारी" : "See your celebrations"}<span aria-hidden="true">↗</span></a>
      </div>
    </div>
  </section>;
}
