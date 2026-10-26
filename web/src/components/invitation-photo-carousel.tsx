"use client";

import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";

import { invitationMediaUrl } from "@/lib/invitation-media";
import { adjacentPhotoSlide, createPhotoCarouselState, photoCarouselReducer, type PhotoSlideStatus } from "@/lib/photo-carousel-state";
import type { Locale } from "@/lib/types";

import styles from "./invitation-photo-carousel.module.css";

type PhotoSlide = {
  image: string;
  small: string;
  large: string;
  width: number;
  height: number;
  alt?: Record<Locale, string>;
};

const slides: readonly PhotoSlide[] = [
  {
    image: "prewedding-lakeside-1066.webp", small: "prewedding-lakeside-640.webp", large: "prewedding-lakeside-1066.webp", width: 1066, height: 1600,
    alt: { en: "The couple together by the lake during their pre-wedding shoot", hi: "प्री-वेडिंग शूट में झील के किनारे साथ खड़े दूल्हा-दुल्हन" }
  },
  {
    image: "prewedding-palace-1066.webp", small: "prewedding-palace-640.webp", large: "prewedding-palace-1066.webp", width: 1066, height: 1600,
    alt: { en: "The couple beneath a colorful palace arch during their pre-wedding shoot", hi: "प्री-वेडिंग शूट में महल की रंगीन मेहराब के नीचे दूल्हा-दुल्हन" }
  },
  {
    image: "prewedding-hawa-mahal-1066.webp", small: "prewedding-hawa-mahal-640.webp", large: "prewedding-hawa-mahal-1066.webp", width: 1066, height: 1600,
    alt: { en: "The couple sitting in front of Hawa Mahal during their pre-wedding shoot", hi: "प्री-वेडिंग शूट में हवा महल के सामने बैठे दूल्हा-दुल्हन" }
  }
];

const copy = {
  en: {
    gallery: "Our pre-wedding photographs",
    carousel: "carousel",
    slide: "slide",
    previous: "Previous photograph",
    next: "Next photograph",
    pause: "Pause slideshow",
    play: "Play slideshow",
    photo: (index: number) => `Photograph ${index + 1} of ${slides.length}`
  },
  hi: {
    gallery: "हमारी प्री-वेडिंग तस्वीरें",
    carousel: "स्लाइडशो",
    slide: "स्लाइड",
    previous: "पिछली तस्वीर",
    next: "अगली तस्वीर",
    pause: "स्लाइडशो रोकें",
    play: "स्लाइडशो चलाएँ",
    photo: (index: number) => `तस्वीर ${index + 1}, कुल ${slides.length}`
  }
};

function subscribeToMotionPreference(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function pageIsVisible() {
  return document.visibilityState === "visible";
}

/** Photos retain the invitation gate and never pass through the public optimizer. */
export function InvitationPhotoCarousel({
  token,
  locale,
  alt,
  paused = false,
  sizes = "(max-width: 760px) min(320px, calc(100vw - 38px)), (max-width: 1340px) 43vw, 520px"
}: {
  token: string;
  locale: Locale;
  alt: string;
  paused?: boolean;
  sizes?: string;
}) {
  const labels = copy[locale];
  const [state, dispatch] = useReducer(photoCarouselReducer, slides.length, createPhotoCarouselState);
  const { activeIndex, pendingIndex, slideStatuses } = state;
  const [playbackPreference, setPlaybackPreference] = useState<boolean | null>(null);
  const imageRefs = useRef<Array<HTMLImageElement | null>>([]);
  const reduceMotion = useSyncExternalStore(subscribeToMotionPreference, prefersReducedMotion, () => true);
  const visible = useSyncExternalStore(subscribeToVisibility, pageIsVisible, () => false);
  const wantsPlayback = playbackPreference ?? !reduceMotion;
  const isPlaying = wantsPlayback && visible && !paused;

  useEffect(() => {
    // Server-rendered pictures can finish loading before hydration attaches
    // onLoad. Reconcile their actual readiness so cached photos also replay.
    const frame = window.requestAnimationFrame(() => {
      const initialStatuses: PhotoSlideStatus[] = slides.map((_, index) => {
        const img = imageRefs.current[index];
        return img?.complete ? img.naturalWidth > 0 ? "ready" : "failed" : "loading";
      });
      dispatch({ type: "reconcile", statuses: initialStatuses });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const nextIndex = adjacentPhotoSlide(state, 1);
  const canNavigate = slideStatuses.filter((status) => status !== "failed").length > 1;
  useEffect(() => {
    // Wait for the next photo before fading; a slow connection keeps the
    // current portrait visible rather than revealing an empty frame.
    if (!isPlaying || nextIndex === activeIndex || slideStatuses[activeIndex] !== "ready" || slideStatuses[nextIndex] !== "ready") return;
    const timer = window.setTimeout(() => dispatch({ type: "advance", from: activeIndex }), 5500);
    return () => window.clearTimeout(timer);
  }, [activeIndex, isPlaying, nextIndex, slideStatuses]);

  function changePhoto(direction: 1 | -1) {
    setPlaybackPreference(false);
    dispatch({ type: "navigate", direction });
  }

  return (
    <div
      className={styles.carousel}
      role="region"
      aria-roledescription={labels.carousel}
      aria-label={labels.gallery}
      aria-busy={pendingIndex !== null}
      data-playing={isPlaying ? "true" : "false"}
      onFocusCapture={(event) => {
        // Keyboard users can inspect the controls without the photo changing.
        // Playback stays paused until they explicitly choose Play.
        if (event.target instanceof HTMLElement && event.target.matches(":focus-visible")) setPlaybackPreference(false);
      }}
    >
      <div className={styles.viewport}>
        {slides.map((slide, index) => (
          <div
            key={slide.image}
            className={`${styles.slide} ${index === activeIndex ? styles.active : ""}`}
            role="group"
            aria-roledescription={labels.slide}
            aria-label={labels.photo(index)}
            aria-hidden={index !== activeIndex}
            data-slide={index + 1}
          >
            <picture>
              <source
                type="image/webp"
                srcSet={`${invitationMediaUrl(token, slide.small)} 640w, ${invitationMediaUrl(token, slide.large)} ${slide.width}w`}
                sizes={sizes}
              />
              {/* Native picture sources keep every image behind the private media route. */}
              <img
                ref={(img) => { imageRefs.current[index] = img; }}
                src={invitationMediaUrl(token, slide.image)}
                alt={slide.alt?.[locale] ?? alt}
                width={slide.width}
                height={slide.height}
                loading={index === 0 ? "eager" : "lazy"}
                fetchPriority={index === 0 ? "high" : "low"}
                decoding="async"
                onLoad={() => dispatch({ type: "loaded", index })}
                onError={() => dispatch({ type: "failed", index })}
              />
            </picture>
          </div>
        ))}
      </div>

      <div className={styles.controlBar}>
        <p className={styles.counter} aria-live={isPlaying ? "off" : "polite"} aria-atomic="true">
          <span className={styles.screenReaderOnly}>{labels.photo(activeIndex)}</span>
          <span aria-hidden="true">{String(activeIndex + 1).padStart(2, "0")} <span className={styles.counterDivider}>/</span> {String(slides.length).padStart(2, "0")}</span>
        </p>
        <div className={styles.controls}>
          <button type="button" aria-label={labels.previous} title={labels.previous} disabled={!canNavigate} onClick={() => changePhoto(-1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
          </button>
          <button
            type="button"
            aria-label={wantsPlayback ? labels.pause : labels.play}
            title={wantsPlayback ? labels.pause : labels.play}
            onClick={() => setPlaybackPreference(!wantsPlayback)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {wantsPlayback ? <path d="M9 6v12M15 6v12" /> : <path className={styles.playIcon} d="m9 5 11 7-11 7Z" />}
            </svg>
          </button>
          <button type="button" aria-label={labels.next} title={labels.next} disabled={!canNavigate} onClick={() => changePhoto(1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
