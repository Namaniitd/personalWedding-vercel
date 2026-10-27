"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";

import { useScrollScenes } from "@/lib/use-scroll-scenes";
import type { Locale, WeddingDetails } from "@/lib/types";

import { CoupleNames, splitCoupleNames } from "./couple-names";
import { InvitationMusic, type InvitationMusicHandle } from "./invitation-music";
import { Mandala, PetalField } from "./motion-ornaments";
import styles from "./wedding-experience.module.css";

function subscribeToMotion(listener: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function reducedMotion() { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
function subscribeToHydration() { return () => {}; }
function clientIsReady() { return true; }
function serverIsReady() { return false; }
function hasAnchor() { return Boolean(window.location.hash); }

/** The invitation remains readable without JavaScript; the cover enhances it after hydration. */
export function WeddingExperience({ wedding, invitationToken, locale, mediaPlaying = false, children }: {
  wedding: WeddingDetails;
  invitationToken: string;
  locale: Locale;
  mediaPlaying?: boolean;
  children: (motionPaused: boolean) => ReactNode;
}) {
  const [stage, setStage] = useState<"closed" | "opening" | "opened">("closed");
  const [animateEntrance, setAnimateEntrance] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const reduceMotion = useSyncExternalStore(subscribeToMotion, reducedMotion, () => true);
  const hydrated = useSyncExternalStore(subscribeToHydration, clientIsReady, serverIsReady);
  // A direct link to RSVP or another section should reach that section immediately.
  const anchored = useSyncExternalStore(subscribeToHydration, hasAnchor, serverIsReady);
  const root = useRef<HTMLDivElement>(null);
  const cover = useRef<HTMLDivElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const skipButton = useRef<HTMLButtonElement>(null);
  const music = useRef<InvitationMusicHandle>(null);
  const openingTimer = useRef<number | undefined>(undefined);
  const motionActive = hydrated && !motionPaused && !reduceMotion;
  const covered = hydrated && !anchored && stage !== "opened";
  const couple = splitCoupleNames(wedding.couple.en, "en");
  const initials = couple ? [couple.groom[0], couple.bride[0]] : [wedding.couple.en[0] ?? "", ""];
  useScrollScenes(root, motionActive && !covered, locale);

  useEffect(() => {
    if (covered && stage === "closed") openButton.current?.focus({ preventScroll: true });
    if (covered && stage === "opening") skipButton.current?.focus({ preventScroll: true });
    if (stage === "opened") document.getElementById("invitation-title")?.focus({ preventScroll: true });
  }, [covered, stage]);

  useEffect(() => () => window.clearTimeout(openingTimer.current), []);

  useEffect(() => {
    const element = root.current;
    if (!element || !motionActive || covered || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      (entry.target as HTMLElement).dataset.revealed = String(entry.isIntersecting);
    }), { threshold: .05, rootMargin: "0px 0px 40px 0px" });
    element.dataset.scrollReady = "true";
    element.querySelectorAll("[data-reveal]").forEach((section) => observer.observe(section));
    return () => { observer.disconnect(); delete element.dataset.scrollReady; };
  }, [motionActive, covered]);

  function enter(animate = true) {
    // Start default-on music within the opening gesture for mobile playback.
    music.current?.start();
    window.clearTimeout(openingTimer.current);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    const shouldAnimate = animate && motionActive;
    setAnimateEntrance(shouldAnimate);
    if (!shouldAnimate) { setStage("opened"); return; }
    setStage("opening");
    openingTimer.current = window.setTimeout(() => setStage("opened"), 1450);
  }

  function coverKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); enter(false); }
    if (event.key !== "Tab") return;
    const buttons = [...(cover.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (!buttons.length) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
  }

  const hi = locale === "hi";
  return <div ref={root} className={styles.experience} lang={locale} data-opening={covered ? stage : "opened"} data-entrance={animateEntrance ? "animated" : "instant"} data-motion={motionActive ? "on" : "off"}>
    <div inert={covered} className={styles["invitation-content"]}>
      <div className={styles["reading-progress"]} aria-hidden="true" />
      {children(!motionActive || covered)}
      {hydrated && <div className={styles["experience-controls"]} aria-label={hi ? "निमंत्रण के एनीमेशन और संगीत" : "Invitation animation and music controls"}>
        <button type="button" onClick={() => setMotionPaused(!motionPaused)} disabled={reduceMotion} aria-label={reduceMotion ? (hi ? "एनीमेशन कम रखने की सेटिंग चालू है" : "Reduced motion is enabled") : motionPaused ? (hi ? "एनीमेशन चलाएँ" : "Resume animations") : (hi ? "एनीमेशन रोकें" : "Pause animations")} aria-pressed={motionPaused || reduceMotion}>
          <span aria-hidden="true">{motionPaused || reduceMotion ? "▷" : "Ⅱ"}</span>
          {reduceMotion ? (hi ? "सीमित एनीमेशन" : "Reduced motion") : motionPaused ? (hi ? "एनीमेशन बंद" : "Animations off") : (hi ? "एनीमेशन चालू" : "Animations on")}
        </button>
        <InvitationMusic ref={music} key={invitationToken} token={invitationToken} locale={locale} paused={mediaPlaying} active={!covered} />
      </div>}
    </div>

    {covered && <div ref={cover} className={`${styles["invitation-cover"]} ${stage === "opening" ? styles["is-opening"] : ""}`} role="dialog" aria-modal="true" aria-labelledby="opening-title" aria-describedby="opening-description" onKeyDown={coverKeyboard}>
      <div className={`${styles["cover-door"]} ${styles["door-left"]}`} aria-hidden="true"><div className={styles["cover-door-frame"]} /></div>
      <div className={`${styles["cover-door"]} ${styles["door-right"]}`} aria-hidden="true"><div className={styles["cover-door-frame"]} /></div>
      <div className={styles["cover-atmosphere"]} aria-hidden="true"><Mandala className={styles["cover-background-mandala"]} /><PetalField /></div>
      <div className={styles["cover-topline"]}><span>{hi ? "सप्रेम निमंत्रण" : "WITH LOVE"}</span><span lang="hi">शुभ विवाह</span></div>
      <div className={styles["cover-content"]}>
        <p className={styles["cover-invocation"]} lang="sa">{wedding.guestContent?.hero?.invocation ?? "॥ श्री गणेशाय नमः ॥"}</p>
        <div className={styles["cover-emblem"]}><Mandala /><span aria-hidden="true">{initials[0]}{initials[1] && <><em>&</em>{initials[1]}</>}</span></div>
        <p className={styles["cover-eyebrow"]}>{hi ? "अपनों के स्नेह और आशीर्वाद के साथ" : "TOGETHER WITH OUR FAMILIES"}</p>
        <h1 id="opening-title"><CoupleNames names={wedding.couple[locale]} locale={locale} parents={wedding.guestContent?.hero?.parents} /></h1>
        <div className={styles["cover-divider"]} aria-hidden="true"><span /><i>✦</i><span /></div>
        <p id="opening-description" className={styles["cover-message"]}>{hi ? "हमारी खुशियों में शामिल हों।" : "Join us as we celebrate."}<br /><em>{hi ? "मिलकर बनाएँ जीवन भर की यादें।" : "Let’s make memories together."}</em></p>
        <p className={styles["cover-date"]}>{wedding.date[locale]} <span>·</span> {wedding.location[locale]}</p>
        <button ref={openButton} className={styles["open-invitation-button"]} type="button" disabled={stage === "opening"} onClick={() => enter()}>{stage === "opening" ? (hi ? "एक खूबसूरत शुरुआत…" : "A beautiful beginning…") : (hi ? "अपना निमंत्रण खोलें" : "Open your invitation")}<span aria-hidden="true">→</span></button>
        <button ref={skipButton} className={styles["skip-opening"]} type="button" onClick={() => enter(false)}>{hi ? "बिना एनीमेशन के खोलें" : "Enter without animation"} <span aria-hidden="true">↗</span></button>
      </div>
      <p className={styles["cover-bottomline"]}>{hi ? "आपके आने से हमारी खुशियाँ और बढ़ेंगी।" : "WE WOULD LOVE TO CELEBRATE WITH YOU."}</p>
    </div>}
  </div>;
}
