export const INVITATION_MUSIC = {
  asset: "raabta-instrumental.m4a",
  title: "Raabta · Instrumental",
  artist: "Havana The Band · Sound Spirit",
  watchUrl: "https://www.youtube.com/watch?v=Fa8AXcfLXs4",
  volume: 0.35
} as const;

export type InvitationMusicStatus = "loading" | "playing" | "paused" | "blocked" | "error";

/** The opening gesture or sound control can start playback on mobile browsers. */
export function createInvitationMusicPlayer(audio: HTMLAudioElement, source: string, onStatus: (status: InvitationMusicStatus) => void) {
  let wanted = false;
  let closed = false;
  let generation = 0;
  audio.preload = "none";
  audio.loop = true;
  audio.volume = INVITATION_MUSIC.volume;
  audio.src = source;

  function playing() {
    if (!wanted) { audio.pause(); return; }
    onStatus("playing");
  }
  function waiting() { if (wanted) onStatus("loading"); }
  // A failed media request can emit pause after error; keep its retry available.
  function paused() { onStatus(audio.error ? "error" : "paused"); }
  function failed() { onStatus("error"); }
  audio.addEventListener("playing", playing);
  audio.addEventListener("waiting", waiting);
  audio.addEventListener("pause", paused);
  audio.addEventListener("error", failed);

  return {
    setPlaying(value: boolean) {
      if (closed) return;
      // Hydration and opening transitions can repeat a request already in progress.
      if (wanted === value && (value ? !audio.paused : audio.paused)) return;
      wanted = value;
      const request = ++generation;
      if (!wanted) {
        audio.pause();
        onStatus("paused");
        return;
      }
      onStatus("loading");
      void audio.play().catch((error: unknown) => {
        // Pausing, retrying or leaving the page can reject an earlier play().
        if (closed || request !== generation || !wanted) return;
        const name = error && typeof error === "object" && "name" in error ? error.name : "";
        if (name === "AbortError") return;
        onStatus(name === "NotAllowedError" ? "blocked" : "error");
      });
    },
    close() {
      if (closed) return;
      closed = true;
      wanted = false;
      generation++;
      audio.removeEventListener("playing", playing);
      audio.removeEventListener("waiting", waiting);
      audio.removeEventListener("pause", paused);
      audio.removeEventListener("error", failed);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
  };
}
