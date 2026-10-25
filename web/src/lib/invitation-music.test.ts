import { beforeEach, describe, expect, it, vi } from "vitest";

import { invitationMediaUrl } from "./invitation-media";
import { createInvitationMusicPlayer, INVITATION_MUSIC } from "./invitation-music";

describe("local invitation music", () => {
  let audio: HTMLAudioElement;
  const onStatus = vi.fn();
  const play = vi.fn<() => Promise<void>>();
  const pause = vi.fn();
  const load = vi.fn();
  const removeAttribute = vi.fn();
  const source = invitationMediaUrl("synthetic-music-invitation", INVITATION_MUSIC.asset);

  beforeEach(() => {
    vi.clearAllMocks();
    play.mockReset().mockResolvedValue(undefined);
    audio = Object.assign(new EventTarget(), { src: "", volume: 1, loop: false, paused: true, preload: "auto", play, pause, load, removeAttribute }) as unknown as HTMLAudioElement;
  });

  it("uses the selected recording through the invitation's own media gate", () => {
    expect(INVITATION_MUSIC.watchUrl).toBe("https://www.youtube.com/watch?v=Fa8AXcfLXs4");
    expect(source).toBe("/i/synthetic-music-invitation/media/raabta-instrumental.m4a");
    expect(invitationMediaUrl("public-invitation-groom", INVITATION_MUSIC.asset)).toBe("/rsvp/g/media/raabta-instrumental.m4a");
    expect(invitationMediaUrl("public-invitation-bride", INVITATION_MUSIC.asset)).toBe("/rsvp/b/media/raabta-instrumental.m4a");
  });

  it("starts quietly within the user gesture and reports playing only after actual playback", () => {
    const player = createInvitationMusicPlayer(audio, source, onStatus);
    expect(play).not.toHaveBeenCalled();
    expect(audio.preload).toBe("none");
    play.mockImplementation(async () => {
      expect(audio.volume).toBe(0.35);
      expect(audio.loop).toBe(true);
      expect(audio.src).toBe(source);
    });
    player.setPlaying(true);
    expect(play).toHaveBeenCalledOnce();
    expect(onStatus).not.toHaveBeenCalledWith("playing");
    audio.dispatchEvent(new Event("playing"));
    expect(onStatus).toHaveBeenLastCalledWith("playing");
    player.close();
  });

  it("pauses pending playback for the teaser or hidden tab, then resumes", async () => {
    let rejectPlay: (error: Error) => void = () => {};
    play.mockImplementationOnce(() => new Promise((_, reject) => { rejectPlay = reject; }));
    const player = createInvitationMusicPlayer(audio, source, onStatus);
    player.setPlaying(true);
    player.setPlaying(false);
    audio.dispatchEvent(new Event("playing"));
    expect(pause).toHaveBeenCalled();
    rejectPlay(new DOMException("Interrupted by pause", "AbortError"));
    await Promise.resolve();
    expect(onStatus).toHaveBeenLastCalledWith("paused");
    expect(onStatus).not.toHaveBeenCalledWith("error");
    expect(onStatus).not.toHaveBeenCalledWith("playing");
    player.setPlaying(true);
    audio.dispatchEvent(new Event("playing"));
    expect(play).toHaveBeenCalledTimes(2);
    expect(onStatus).toHaveBeenLastCalledWith("playing");
    player.close();
  });

  it("keeps default music playing when the opening animation completes", () => {
    const player = createInvitationMusicPlayer(audio, source, onStatus);
    player.setPlaying(true);
    Object.defineProperty(audio, "paused", { value: false });
    audio.dispatchEvent(new Event("playing"));
    const count = onStatus.mock.calls.length;
    player.setPlaying(true);
    expect(play).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenLastCalledWith("playing");
    expect(onStatus).toHaveBeenCalledTimes(count);
    player.close();
  });

  it("offers a real retry after browser restrictions and reports a failed audio response", async () => {
    play.mockRejectedValueOnce(new DOMException("User interaction required", "NotAllowedError"));
    const player = createInvitationMusicPlayer(audio, source, onStatus);
    player.setPlaying(true);
    await Promise.resolve();
    expect(onStatus).toHaveBeenLastCalledWith("blocked");
    player.setPlaying(true);
    audio.dispatchEvent(new Event("playing"));
    expect(onStatus).toHaveBeenLastCalledWith("playing");
    Object.defineProperty(audio, "error", { value: { code: 4 } });
    audio.dispatchEvent(new Event("error"));
    audio.dispatchEvent(new Event("pause"));
    expect(onStatus).toHaveBeenLastCalledWith("error");
    player.close();
  });

  it("ignores an older rejected play when playback has already resumed", async () => {
    let rejectPlay: (error: Error) => void = () => {};
    play.mockImplementationOnce(() => new Promise((_, reject) => { rejectPlay = reject; }));
    const player = createInvitationMusicPlayer(audio, source, onStatus);
    player.setPlaying(true);
    player.setPlaying(false);
    player.setPlaying(true);
    audio.dispatchEvent(new Event("playing"));
    rejectPlay(new DOMException("Old request failed", "NotAllowedError"));
    await Promise.resolve();
    expect(onStatus).toHaveBeenLastCalledWith("playing");
    player.close();
  });

  it("stops playback and releases the source when switched off, ignoring late events", async () => {
    let rejectPlay: (error: Error) => void = () => {};
    play.mockImplementationOnce(() => new Promise((_, reject) => { rejectPlay = reject; }));
    const player = createInvitationMusicPlayer(audio, source, onStatus);
    player.setPlaying(true);
    player.close();
    expect(pause).toHaveBeenCalledOnce();
    expect(removeAttribute).toHaveBeenCalledWith("src");
    expect(load).toHaveBeenCalledOnce();
    const count = onStatus.mock.calls.length;
    audio.dispatchEvent(new Event("playing"));
    audio.dispatchEvent(new Event("error"));
    rejectPlay(new Error("Late network error"));
    await Promise.resolve();
    player.setPlaying(true);
    player.close();
    expect(onStatus).toHaveBeenCalledTimes(count);
    expect(play).toHaveBeenCalledOnce();
  });
});
