"use client";

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * What part of the stage is on screen, in CSS px of the scaled stage.
 * Without a camera the whole stage is visible (offsetX 0, viewW = stage width).
 */
export type StageView = { offsetX: number; viewW: number } | null;
const StageViewContext = createContext<StageView>(null);
export const useStageView = () => useContext(StageViewContext);

/** Below this container width, `squareOnPhones` switches to the taller, panning view. */
const PHONE_MAX = 640;
import type { ArtAsset } from "@/assets/manifest";

/**
 * The game screen. Renders a background at its native pixel size (e.g. 320×192)
 * and scales the whole stage by a WHOLE number (1×, 2×, 3×...) so every art pixel
 * stays square and sharp. Children are positioned in art-pixel coordinates.
 * On screens narrower than the art, it falls back to a uniform fractional scale
 * (still no stretching).
 * `fit="device"` (Play Mode) scales in whole DEVICE pixels instead, so on a
 * retina screen it can use 2.5×, 3.5× … and fill more of the space while every
 * art pixel stays perfectly square. `maxHeight` keeps the stage on screen.
 * `squareOnPhones` (height ÷ width, e.g. 0.92) makes the view almost square on
 * narrow screens: the art fills the height and a simple camera pans
 * sideways to keep `focusX` (art px) in view.
 */
export function PixelStage({
  art,
  label,
  frame = "panel",
  children,
  tag,
  overlay,
  className = "",
  fit = "integer",
  maxHeight,
  squareOnPhones,
  focusX,
}: {
  art: ArtAsset;
  label: string;
  frame?: string;
  children?: ReactNode;
  /** Small label shown in the corner (e.g. "Placeholder"). */
  tag?: string;
  /** Unscaled layer on top (readable UI text). Position children with percentages. */
  overlay?: ReactNode;
  className?: string;
  fit?: "integer" | "device";
  /** Upper bound for the stage height in CSS px. */
  maxHeight?: number;
  squareOnPhones?: number;
  /** Art-pixel x the camera keeps centred (when the view is narrower than the art). */
  focusX?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [boxW, setBoxW] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      const dpr = fit === "device" ? Math.max(1, Math.round(window.devicePixelRatio || 1)) : 1;
      let s = w / art.width;
      if (squareOnPhones && w < PHONE_MAX) s = Math.max(s, (w * squareOnPhones) / art.height);
      else if (maxHeight) s = Math.min(s, Math.max(1, maxHeight / art.height));
      setBoxW(w);
      setScale(s >= 1 ? Math.floor(s * dpr) / dpr : s);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [art.width, art.height, fit, maxHeight, squareOnPhones]);

  const w = art.width * scale;
  const h = art.height * scale;
  // Camera: only when the scaled art is wider than the frame (phones).
  const panning = scale > 0 && boxW > 0 && w > boxW + 0.5;
  const viewArt = panning ? boxW / scale : art.width;
  const camX = panning ? Math.min(art.width - viewArt, Math.max(0, (focusX ?? art.width / 2) - viewArt / 2)) : 0;
  const offsetX = Math.round(camX * scale);
  const view: StageView = scale > 0 ? { offsetX, viewW: panning ? boxW : w } : null;

  return (
    <div className={`px-frame px-shadow ${className}`} style={{ "--frame": `var(--frame-${frame})` } as CSSProperties}>
      <div ref={box} data-stage-view className="px-checker relative grid w-full place-items-center overflow-hidden" style={{ height: scale ? h : undefined, aspectRatio: scale ? undefined : `${art.width} / ${art.height}` }}>
        {scale > 0 && (
          <StageViewContext.Provider value={view}>
          <div
            className={`${panning ? "absolute left-0 top-0 transition-transform duration-500 ease-out" : "relative"}`}
            style={{ width: w, height: h, transform: panning ? `translateX(${-offsetX}px)` : undefined }}
          >
            <div className="absolute left-0 top-0 origin-top-left" style={{ width: art.width, height: art.height, transform: `scale(${scale})` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={art.src} alt={label} width={art.width} height={art.height} draggable={false} className="pixelated absolute inset-0 block size-full" />
              {children}
            </div>
            {overlay && <div className="pointer-events-none absolute inset-0">{overlay}</div>}
          </div>
          </StageViewContext.Provider>
        )}
        {scale > 0 && tag && art.placeholder && (
          <span className="absolute top-1 bg-white/90 px-1.5 py-0.5 font-label text-[9px] uppercase leading-none text-ink-soft" style={{ right: panning ? 4 : Math.max(4, (boxW - w) / 2 + 4) }}>
            {tag}
          </span>
        )}
      </div>
    </div>
  );
}
