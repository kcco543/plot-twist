"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      let s = w / art.width;
      if (maxHeight) s = Math.min(s, Math.max(1, maxHeight / art.height));
      const dpr = fit === "device" ? Math.max(1, Math.round(window.devicePixelRatio || 1)) : 1;
      setScale(s >= 1 ? Math.floor(s * dpr) / dpr : s);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [art.width, art.height, fit, maxHeight]);

  const w = art.width * scale;
  const h = art.height * scale;

  return (
    <div className={`px-frame px-shadow ${className}`} style={{ "--frame": `var(--frame-${frame})` } as CSSProperties}>
      <div ref={box} className="px-checker relative grid w-full place-items-center overflow-hidden" style={{ height: scale ? h : undefined, aspectRatio: scale ? undefined : `${art.width} / ${art.height}` }}>
        {scale > 0 && (
          <div className="relative" style={{ width: w, height: h }}>
            <div className="absolute left-0 top-0 origin-top-left" style={{ width: art.width, height: art.height, transform: `scale(${scale})` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={art.src} alt={label} width={art.width} height={art.height} draggable={false} className="pixelated absolute inset-0 block size-full" />
              {children}
            </div>
            {overlay && <div className="pointer-events-none absolute inset-0">{overlay}</div>}
            {tag && art.placeholder && (
              <span className="absolute right-1 top-1 bg-white/90 px-1.5 py-0.5 font-label text-[9px] uppercase leading-none text-ink-soft">{tag}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
