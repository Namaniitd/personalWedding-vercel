export type PhotoSlideStatus = "loading" | "ready" | "failed";

export type PhotoCarouselState = {
  activeIndex: number;
  pendingIndex: number | null;
  slideStatuses: PhotoSlideStatus[];
};

export type PhotoCarouselAction =
  | { type: "reconcile"; statuses: readonly PhotoSlideStatus[] }
  | { type: "loaded"; index: number }
  | { type: "failed"; index: number }
  | { type: "navigate"; direction: 1 | -1 }
  | { type: "advance"; from: number };

export function createPhotoCarouselState(count: number): PhotoCarouselState {
  return { activeIndex: 0, pendingIndex: null, slideStatuses: Array<PhotoSlideStatus>(count).fill("loading") };
}

export function adjacentPhotoSlide(state: PhotoCarouselState, direction: 1 | -1, from = state.activeIndex) {
  const count = state.slideStatuses.length;
  for (let offset = 1; offset < count; offset += 1) {
    const index = (from + direction * offset + count) % count;
    if (state.slideStatuses[index] !== "failed") return index;
  }
  return from;
}

function reconcileSelection(state: PhotoCarouselState, slideStatuses: PhotoSlideStatus[]): PhotoCarouselState {
  let { activeIndex, pendingIndex } = state;
  if (pendingIndex !== null) {
    if (slideStatuses[pendingIndex] === "ready") {
      activeIndex = pendingIndex;
      pendingIndex = null;
    } else if (slideStatuses[pendingIndex] === "failed") {
      pendingIndex = null;
    }
  }
  if (slideStatuses[activeIndex] === "failed") {
    const replacement = slideStatuses.findIndex((status) => status === "ready");
    if (replacement >= 0) activeIndex = replacement;
  }
  if (slideStatuses.every((status) => status === "failed")) pendingIndex = null;
  return { activeIndex, pendingIndex, slideStatuses };
}

/** Readiness and selection change together even when image events are batched. */
export function photoCarouselReducer(state: PhotoCarouselState, action: PhotoCarouselAction): PhotoCarouselState {
  if (action.type === "reconcile") {
    const statuses = state.slideStatuses.map((status, index) => status === "loading" ? action.statuses[index] ?? status : status);
    return reconcileSelection(state, statuses);
  }
  if (action.type === "loaded" || action.type === "failed") {
    const statuses = state.slideStatuses.map((status, index) => index === action.index ? action.type === "loaded" ? "ready" : "failed" : status);
    return reconcileSelection(state, statuses);
  }
  if (action.type === "navigate") {
    const index = adjacentPhotoSlide(state, action.direction, state.pendingIndex ?? state.activeIndex);
    if (state.slideStatuses[index] === "failed") return { ...state, pendingIndex: null };
    return state.slideStatuses[index] === "ready"
      ? { ...state, activeIndex: index, pendingIndex: null }
      : { ...state, pendingIndex: index };
  }
  // A queued timer must not override a newer manual selection or load request.
  if (action.from !== state.activeIndex || state.pendingIndex !== null) return state;
  const index = adjacentPhotoSlide(state, 1);
  return state.slideStatuses[state.activeIndex] === "ready" && state.slideStatuses[index] === "ready"
    ? { ...state, activeIndex: index }
    : state;
}
