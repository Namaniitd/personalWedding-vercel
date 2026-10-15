import { describe, expect, it } from "vitest";

import { createPhotoCarouselState, photoCarouselReducer } from "./photo-carousel-state";

describe("private photo carousel readiness", () => {
  it("replays photos that finished loading before hydration and wraps to the first", () => {
    let state = photoCarouselReducer(createPhotoCarouselState(3), { type: "reconcile", statuses: ["ready", "ready", "ready"] });
    for (const index of [1, 2, 0]) {
      state = photoCarouselReducer(state, { type: "advance", from: state.activeIndex });
      expect(state.activeIndex).toBe(index);
    }
    expect(state.pendingIndex).toBeNull();
  });

  it("finds a ready fallback whichever order an active failure and another load arrive", () => {
    const initial = createPhotoCarouselState(3);
    const failureFirst = photoCarouselReducer(photoCarouselReducer(initial, { type: "failed", index: 0 }), { type: "loaded", index: 1 });
    const loadFirst = photoCarouselReducer(photoCarouselReducer(initial, { type: "loaded", index: 1 }), { type: "failed", index: 0 });
    expect(failureFirst).toEqual(loadFirst);
    expect(failureFirst.activeIndex).toBe(1);
  });

  it("resolves a manual request when its image loads or reconciliation discovers it cached", () => {
    const initial = photoCarouselReducer(createPhotoCarouselState(3), { type: "loaded", index: 0 });
    const pending = photoCarouselReducer(initial, { type: "navigate", direction: 1 });
    expect(pending.activeIndex).toBe(0);
    expect(pending.pendingIndex).toBe(1);
    for (const action of [{ type: "loaded", index: 1 }, { type: "reconcile", statuses: ["ready", "ready", "loading"] }] as const) {
      const ready = photoCarouselReducer(pending, action);
      expect(ready.activeIndex).toBe(1);
      expect(ready.pendingIndex).toBeNull();
    }
  });

  it("keeps the current photo and clears busy state if a requested image fails", () => {
    const initial = photoCarouselReducer(createPhotoCarouselState(3), { type: "loaded", index: 0 });
    const pending = photoCarouselReducer(initial, { type: "navigate", direction: 1 });
    const failed = photoCarouselReducer(pending, { type: "failed", index: 1 });
    expect(failed.activeIndex).toBe(0);
    expect(failed.pendingIndex).toBeNull();
  });

  it("does not retain a spinner or create new pending requests after every image fails", () => {
    let state = photoCarouselReducer(createPhotoCarouselState(3), { type: "navigate", direction: 1 });
    for (const index of [0, 1, 2]) state = photoCarouselReducer(state, { type: "failed", index });
    for (const direction of [1, -1] as const) {
      state = photoCarouselReducer(state, { type: "navigate", direction });
      expect(state.pendingIndex).toBeNull();
    }
  });

  it("skips unavailable photos and ignores a timer queued before manual navigation", () => {
    const initial = photoCarouselReducer(createPhotoCarouselState(3), { type: "reconcile", statuses: ["ready", "failed", "ready"] });
    const next = photoCarouselReducer(initial, { type: "advance", from: 0 });
    expect(next.activeIndex).toBe(2);
    expect(photoCarouselReducer(next, { type: "advance", from: 2 }).activeIndex).toBe(0);
    const manual = photoCarouselReducer(initial, { type: "navigate", direction: -1 });
    expect(photoCarouselReducer(manual, { type: "advance", from: 0 })).toBe(manual);
  });
});
