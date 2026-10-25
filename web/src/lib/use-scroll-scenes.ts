"use client";

import { useEffect, type RefObject } from "react";

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

type Scene = {
  element: HTMLElement;
  top: number;
  height: number;
  story: {
    height: number;
    inset: number;
    images: HTMLElement[];
    chapters: HTMLElement[];
    captions: HTMLElement[];
  } | null;
};

/** Native scrolling updates CSSOM properties without a React render on every frame. */
export function useScrollScenes(root: RefObject<HTMLDivElement | null>, active: boolean, contentKey: string) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let frame = 0;
    let measurement = 0;
    let disposed = false;
    let scenes: Scene[] = [];

    function resetScenes() {
      element!.querySelectorAll<HTMLElement>("[data-scroll-scene]").forEach((scene) => {
        for (const property of ["--scroll-offset", "--scroll-rotation", "--story-pan", "--story-scale", "--story-height"]) scene.style.removeProperty(property);
        delete scene.dataset.chapter;
        scene.querySelectorAll<HTMLElement>("[data-story-image]").forEach((image) => image.style.removeProperty("opacity"));
        scene.querySelectorAll<HTMLElement>("[data-story-chapter]").forEach((chapter) => {
          chapter.style.removeProperty("--chapter-fill");
          delete chapter.dataset.active;
        });
        scene.querySelectorAll<HTMLElement>("[data-story-caption]").forEach((caption) => { delete caption.dataset.active; });
      });
      delete element!.dataset.storyVisible;
    }

    function update() {
      frame = 0;
      const position = window.scrollY;
      const viewport = window.innerHeight;
      const total = document.documentElement.scrollHeight - viewport;
      element!.style.setProperty("--reading-progress", `${total > 0 ? clamp(position / total) : 0}`);
      let storyVisible = false;
      const amplitude = window.innerWidth <= 760 ? .55 : 1;

      for (const scene of scenes) {
        if (scene.top > position + viewport * 1.4 || scene.top + scene.height < position - viewport * .4) continue;
        const range = Math.min(viewport, scene.height * .75);
        const offset = clamp(position + viewport / 2 - scene.top - scene.height / 2, -range, range) * amplitude;
        scene.element.style.setProperty("--scroll-offset", `${offset.toFixed(2)}px`);
        scene.element.style.setProperty("--scroll-rotation", `${(offset * .035).toFixed(2)}deg`);

        if (scene.story) {
          const count = scene.story.captions.length;
          const pinStart = scene.top - scene.story.inset;
          storyVisible = count > 1 && position >= pinStart - 1 && position <= pinStart + scene.height - scene.story.height + 1;
          const progress = clamp((position - pinStart) / Math.max(1, scene.height - scene.story.height));
          const chapter = Math.min(count - 1, Math.floor(progress * count));
          scene.element.dataset.chapter = String(chapter);
          scene.element.style.setProperty("--story-pan", `${((progress - .5) * -90 * amplitude).toFixed(2)}px`);
          scene.element.style.setProperty("--story-scale", `${(1.14 - progress * .07).toFixed(4)}`);
          scene.story.images.forEach((image, index) => {
            const opacity = index === 0 ? 1 : clamp((progress * count - index + .35) / .7);
            image.style.opacity = opacity.toFixed(4);
          });
          scene.story.captions.forEach((caption, index) => { caption.dataset.active = String(index === chapter); });
          scene.story.chapters.forEach((item, index) => {
            item.dataset.active = String(index === chapter);
            item.style.setProperty("--chapter-fill", `${count === 1 ? 1 : clamp(progress * count - index)}`);
          });
        }
      }
      element!.dataset.storyVisible = String(storyVisible);
    }

    function measure() {
      measurement = 0;
      if (disposed) return;
      const header = element!.querySelector<HTMLElement>("[data-invitation-header]");
      if (header) element!.style.setProperty("--scene-inset", `${header.getBoundingClientRect().height}px`);
      scenes = active ? [...element!.querySelectorAll<HTMLElement>("[data-scroll-scene]")].map((scene) => {
        const stage = scene.querySelector<HTMLElement>("[data-story-stage]");
        const captions = [...scene.querySelectorAll<HTMLElement>("[data-story-caption]")];
        if (stage && captions.length > 1) scene.style.setProperty("--story-height", `${Math.min(360, 95 + captions.length * 45)}svh`);
        const bounds = scene.getBoundingClientRect();
        return {
          element: scene,
          top: bounds.top + window.scrollY,
          height: bounds.height,
          story: stage ? {
            height: stage.getBoundingClientRect().height,
            inset: Number.parseFloat(getComputedStyle(stage).top) || 0,
            images: [...scene.querySelectorAll<HTMLElement>("[data-story-image]")],
            chapters: [...scene.querySelectorAll<HTMLElement>("[data-story-chapter]")],
            captions
          } : null
        };
      }) : [];
      update();
    }

    function requestUpdate() { if (!frame) frame = requestAnimationFrame(update); }
    function requestMeasurement() { if (!measurement) measurement = requestAnimationFrame(measure); }

    measure();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestMeasurement);
    element.addEventListener("load", requestMeasurement, true);
    const resize = new ResizeObserver(requestMeasurement);
    resize.observe(element);
    const header = element.querySelector("[data-invitation-header]");
    if (header) resize.observe(header);
    void document.fonts.ready.then(() => { if (!disposed) requestMeasurement(); });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(measurement);
      resize.disconnect();
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestMeasurement);
      element.removeEventListener("load", requestMeasurement, true);
      resetScenes();
      element.style.removeProperty("--reading-progress");
      element.style.removeProperty("--scene-inset");
    };
  }, [active, root, contentKey]);
}
