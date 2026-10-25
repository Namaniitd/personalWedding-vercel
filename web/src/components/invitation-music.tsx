"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type Ref } from "react";

import { invitationMediaUrl } from "@/lib/invitation-media";
import { createInvitationMusicPlayer, INVITATION_MUSIC, type InvitationMusicStatus } from "@/lib/invitation-music";
import type { Locale } from "@/lib/types";

import styles from "./wedding-experience.module.css";

function subscribeToVisibility(listener: () => void) {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

function pageIsVisible() { return document.visibilityState === "visible"; }

export type InvitationMusicHandle = { start: () => void };

/** Sound starts enabled; the opening gesture begins the local recording. */
export function InvitationMusic({ token, locale, paused, active, ref }: { token: string; locale: Locale; paused: boolean; active: boolean; ref?: Ref<InvitationMusicHandle> }) {
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState<InvitationMusicStatus>("paused");
  const audio = useRef<HTMLAudioElement>(null);
  const toggleButton = useRef<HTMLButtonElement>(null);
  const controller = useRef<ReturnType<typeof createInvitationMusicPlayer> | null>(null);
  const visible = useSyncExternalStore(subscribeToVisibility, pageIsVisible, () => false);
  const panelVisible = enabled && active && status !== "playing";
  const hi = locale === "hi";

  useEffect(() => () => { controller.current?.close(); controller.current = null; }, []);

  const play = useCallback(() => {
    if (!audio.current) return;
    controller.current ??= createInvitationMusicPlayer(audio.current, invitationMediaUrl(token, INVITATION_MUSIC.asset), setStatus);
    controller.current.setPlaying(visible && !paused);
  }, [token, visible, paused]);

  useImperativeHandle(ref, () => ({ start: () => { if (enabled) play(); } }), [enabled, play]);

  useEffect(() => {
    if (enabled && (active || controller.current)) play();
  }, [enabled, active, play]);

  function stop() {
    controller.current?.close();
    controller.current = null;
    setEnabled(false);
    toggleButton.current?.focus({ preventScroll: true });
  }

  function start() {
    if (status === "error") {
      controller.current?.close();
      controller.current = null;
    }
    setEnabled(true);
    // Keep play() inside the user gesture, including blocked autoplay and retries.
    play();
  }

  return <>
    <audio ref={audio} preload="none" loop hidden aria-hidden="true" />
    <span className={styles["controls-divider"]} aria-hidden="true" />
    <button ref={toggleButton} type="button" onClick={enabled ? stop : start} title={`${INVITATION_MUSIC.title} · ${INVITATION_MUSIC.artist}`} aria-label={enabled ? (hi ? "संगीत बंद करें" : "Turn sound off") : (hi ? "राब्ता संगीत चलाएँ" : "Play Raabta music")} aria-pressed={enabled} aria-expanded={panelVisible} aria-controls="invitation-music-player">
      <svg className={styles["music-icon"]} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m11 5-6 5H2v4h3l6 5V5Z" />
        {enabled ? <><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></> : <path d="m16 9 6 6m0-6-6 6" />}
      </svg>
      {enabled ? (hi ? "संगीत चालू" : "Sound on") : (hi ? "संगीत बंद" : "Sound off")}
    </button>
    <span className={styles["scene-sr-only"]} role="status">{enabled && status === "playing" ? (hi ? "राब्ता · Havana The Band का वाद्य संगीत चल रहा है।" : "Playing Raabta, an instrumental cover by Havana The Band.") : ""}</span>
    {panelVisible && <aside className={styles["music-panel"]} id="invitation-music-player" aria-label={hi ? "राब्ता संगीत प्लेयर" : "Raabta music player"} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); stop(); } }}>
      <div className={styles["music-heading"]}>
        <div><strong>{hi ? "राब्ता · वाद्य संगीत" : INVITATION_MUSIC.title}</strong><span>{INVITATION_MUSIC.artist}</span></div>
        <button type="button" onClick={stop} aria-label={hi ? "संगीत बंद करके प्लेयर बंद करें" : "Stop music and close player"}>×</button>
      </div>
      <div className={styles["music-footer"]}>
        <p role="status">{paused ? (hi ? "टीज़र के दौरान संगीत रुका है।" : "Music paused for the teaser.")
          : !visible ? (hi ? "इस पेज पर लौटने पर संगीत फिर चलेगा।" : "Music resumes when you return to this tab.")
          : status === "error" ? (hi ? "संगीत नहीं चल पाया। फिर कोशिश करें।" : "Music couldn’t start. Please retry.")
          : status === "blocked" ? (hi ? "सुनने के लिए संगीत चलाएँ दबाएँ।" : "Tap Play music to listen.")
          : status === "loading" ? (hi ? "संगीत लोड हो रहा है…" : "Loading music…")
          : (hi ? "संगीत रुका है।" : "Music is paused.")}</p>
        {(status === "error" || status === "blocked" || (status === "paused" && visible && !paused)) && <button type="button" onClick={start}>{status === "error" ? (hi ? "फिर कोशिश करें" : "Retry") : (hi ? "संगीत चलाएँ" : "Play music")}</button>}
        <a href={INVITATION_MUSIC.watchUrl} target="_blank" rel="noopener noreferrer">{hi ? "मूल रिकॉर्डिंग ↗" : "Original recording ↗"}</a>
      </div>
    </aside>}
  </>;
}
