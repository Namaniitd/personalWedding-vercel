"use client";

import { useRef, useState } from "react";

import { invitationMediaUrl } from "@/lib/invitation-media";
import type { Locale } from "@/lib/types";
import { ScrollScenery } from "./scroll-scenery";

import styles from "./invitation-teaser.module.css";
import experienceStyles from "./wedding-experience.module.css";

const copy = {
  en: {
    eyebrow: "Before the big day",
    title: "A glimpse of us",
    lead: "A few moments together, before we celebrate with you.",
    watch: "Watch our pre-wedding teaser",
    video: "Pre-wedding teaser",
    error: "The teaser could not play. Please try again when your connection is ready.",
    retry: "Try the teaser again"
  },
  hi: {
    eyebrow: "शुभ विवाह से पहले",
    title: "हमारी कुछ यादें",
    lead: "आपके साथ उत्सव मनाने से पहले, साथ बिताए कुछ खूबसूरत पल।",
    watch: "हमारा प्री-वेडिंग टीज़र देखें",
    video: "प्री-वेडिंग टीज़र",
    error: "टीज़र नहीं चल पाया। कनेक्शन ठीक होने पर फिर प्रयास करें।",
    retry: "टीज़र फिर से चलाएँ"
  }
};

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

/** 4K only for large, sharp desktop screens on a fast, unmetered connection. */
function teaserAsset() {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (connection?.saveData || (connection?.effectiveType && connection.effectiveType !== "4g")) {
    return "prewedding-teaser-hd.mp4";
  }
  const desktop = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const devicePixels = Math.max(window.screen.width, window.screen.height) * window.devicePixelRatio;
  return desktop && devicePixels > 2560 ? "prewedding-teaser-4k.mp4" : "prewedding-teaser-hd.mp4";
}

/** Stable asset names let a later film replace this one without changing the UI. */
export function InvitationTeaser({ token, locale, onPlayingChange }: {
  token: string;
  locale: Locale;
  onPlayingChange: (playing: boolean) => void;
}) {
  const labels = copy[locale];
  const player = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);

  function play() {
    const video = player.current;
    if (!video) return;
    setFailed(false);
    setStarted(true);
    // Attach the source only inside the click gesture: opening or scrolling the
    // invitation must not download the film, even on mobile browsers. A retry
    // after an error uses HD, which every H.264 decoder can play.
    if (!video.getAttribute("src") || video.error) {
      video.src = invitationMediaUrl(token, video.error ? "prewedding-teaser-hd.mp4" : teaserAsset());
      video.load();
    }
    video.tabIndex = 0;
    video.focus({ preventScroll: true });
    void video.play().catch((error: unknown) => {
      // Native Pause can cancel a pending play while the connection is slow.
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFailed(true);
      onPlayingChange(false);
    });
  }

  return (
    <section className={`${styles.section} ${experienceStyles["scene-surface"]}`} id="teaser" data-scroll-scene aria-labelledby="teaser-title">
      <ScrollScenery variant="floral" token={token} />
      <div className={styles.inner}>
        <div className={styles.introduction} data-reveal="section">
          <p className={styles.eyebrow}>{labels.eyebrow}</p>
          <h2 id="teaser-title">{labels.title}</h2>
          <p className={styles.lead}>{labels.lead}</p>
        </div>
        <div className={styles.film}>
          <div className={styles.frame}>
            <video
              ref={player}
              aria-label={labels.video}
              poster={invitationMediaUrl(token, "prewedding-teaser-poster.webp")}
              width={1024}
              height={576}
              preload="none"
              controls={started}
              tabIndex={started ? 0 : -1}
              playsInline
              onPlaying={() => { setFailed(false); onPlayingChange(true); }}
              onPause={() => onPlayingChange(false)}
              onEnded={() => onPlayingChange(false)}
              onError={() => { setFailed(true); onPlayingChange(false); }}
            />
            {!started && <button className={styles.playButton} type="button" onClick={play} aria-label={labels.watch}>
              <span className={styles.playMark} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 5 11 7-11 7Z" /></svg></span>
              <span>{labels.watch}</span>
            </button>}
          </div>
          {failed && <div className={styles.error} role="status">
            <p>{labels.error}</p>
            <button type="button" onClick={play}>{labels.retry}</button>
          </div>}
        </div>
      </div>
    </section>
  );
}
