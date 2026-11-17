"use client";

/**
 * PLAY LAYOUT — how Play Mode splits the screen between the world and the dialogue.
 * --------------------------------------------------------------------------
 * Two shapes, chosen from the real window size (width AND height, not width alone):
 *
 *   side   viewport on the left, dialogue dock on the right (desktop, laptop,
 *          tablet landscape, phone landscape).
 *   stack  viewport on top, dialogue dock directly under it (tablet portrait,
 *          phone portrait).
 *
 * The play area is sized to end at the bottom of the window, so the scene and
 * the response choices are on screen together without scrolling the page.
 * Anything that doesn't fit scrolls inside the dock instead.
 */
import { useLayoutEffect, useState, type RefObject } from "react";

export type PlayShape = "side" | "stack";

/** Side-by-side when the window is wide enough for both columns and not taller than it is wide. */
export function choosePlayShape(width: number, height: number): PlayShape {
  if (width >= 900 && width / Math.max(1, height) >= 1.15) return "side";
  // Phone / small tablet held sideways: still side by side (the stage would be a thin strip otherwise).
  if (width >= 560 && width > height) return "side";
  return "stack";
}

/** Smallest the play area may get before the page itself is allowed to scroll (fallback). */
export const MIN_PLAY_H = { side: 240, stack: 420 } as const;

/**
 * Stacked layout: how much height the dialogue dock keeps under the viewport.
 * Enough for the speaker, two lines of text, the action buttons (or the first
 * response choices) and the character row.
 */
export function stackDockHeight(playH: number): number {
  return Math.round(Math.min(380, Math.max(268, playH * 0.38)));
}

/** Side layout: the dock is at least this tall even next to a short (small-map) viewport. */
export function sideDockMin(playH: number): number {
  return Math.min(420, playH);
}

export type PlayLayout = {
  shape: PlayShape;
  /** Height (CSS px) from the top of the play area to the bottom of the window. 0 until measured. */
  height: number;
  /** Short window (landscape phone, small laptop window): trim decoration. */
  short: boolean;
  /** Height of the sticky top bar (to pin the stage under it). */
  headerH: number;
  /** Thickness of a pixel frame's two borders together (CSS px): 8 × --u. */
  frame: number;
};

const same = (a: PlayLayout, b: PlayLayout) => a.shape === b.shape && a.height === b.height && a.short === b.short && a.headerH === b.headerH && a.frame === b.frame;

/**
 * Measures the play area against the window. `bottomGap` is the space kept
 * under it (the page's bottom padding), so the page ends exactly at the
 * window's bottom edge. Safe areas come from a probe element using env().
 */
export function usePlayLayout(ref: RefObject<HTMLElement | null>, bottomGap = 12): PlayLayout {
  const [state, setState] = useState<PlayLayout>({ shape: "stack", height: 0, short: false, headerH: 0, frame: 16 });
  useLayoutEffect(() => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;height:env(safe-area-inset-bottom,0px)";
    document.body.appendChild(probe);
    let raf = 0;
    let attach = () => {};
    const measure = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      attach();
      const w = window.innerWidth;
      const h = window.innerHeight;
      const shape = choosePlayShape(w, h);
      const top = el.getBoundingClientRect().top + window.scrollY;
      const safe = probe.getBoundingClientRect().height;
      const avail = Math.floor(h - top - Math.max(bottomGap, safe));
      const next: PlayLayout = {
        shape,
        height: Math.max(MIN_PLAY_H[shape], avail),
        short: h < 560,
        headerH: Math.round(document.querySelector("header")?.getBoundingClientRect().height ?? 0),
        frame: 8 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--u")) || 2),
      };
      setState((prev) => (same(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    // Notices above the play area appearing / going away move it down / up. The body's own size may not
    // change when that happens (it is at least the window's height), so watch what sits above the play area.
    const ro = new ResizeObserver(schedule);
    ro.observe(document.body);
    const header = document.querySelector("header");
    if (header) ro.observe(header);
    const watchAbove = () => {
      let n: Element | null = ref.current;
      while (n && n !== document.body) {
        for (let sib = n.previousElementSibling; sib; sib = sib.previousElementSibling) ro.observe(sib);
        n = n.parentElement;
      }
    };
    const mo = new MutationObserver(() => {
      watchAbove();
      schedule();
    });
    // The play area may mount after this effect (the save loads first): attach once it exists.
    let watched: Element | null = null;
    attach = () => {
      const parent = ref.current?.parentElement ?? null;
      if (!parent || parent === watched) return;
      watched = parent;
      mo.observe(parent, { childList: true });
      watchAbove();
    };
    attach();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      ro.disconnect();
      mo.disconnect();
      probe.remove();
    };
  }, [ref, bottomGap]);
  return state;
}
