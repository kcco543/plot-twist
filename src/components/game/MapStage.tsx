"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { isNativeSize } from "@/lib/pixelArt/mapPixels";

/**
 * Frame for a generated map. Same pixel frame as PixelStage, but generated
 * maps are large (e.g. 1536×1024), so the image is fitted to the frame at
 * its own aspect ratio. When it is shown at or above its real size it stays
 * pixel-sharp; when it is shown smaller it is smoothly downscaled, which keeps
 * fine pixel detail from shimmering or breaking up. Maps on the game's pixel
 * grid (480 px wide, PIXEL_ART_STYLE_GUIDE.md §3) are always enlarged, so
 * they are always drawn with nearest-neighbour pixels.
 */
export function MapStage({ src, width, height, label, frame = "card", children }: { src: string; width: number; height: number; label: string; frame?: string; children?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const native = isNativeSize(width);
  const [sharp, setSharp] = useState(native);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSharp(native || entry.contentRect.width * (window.devicePixelRatio || 1) >= width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, native]);

  return (
    <div className="px-frame px-shadow" style={{ "--frame": `var(--frame-${frame})` } as CSSProperties}>
      <div ref={box} className="px-checker relative w-full overflow-hidden" style={{ aspectRatio: `${width} / ${height}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- generated blobs must not go through next/image */}
        <img src={src} alt={label} width={width} height={height} draggable={false} className="absolute inset-0 block size-full object-contain" style={{ imageRendering: sharp ? "pixelated" : "auto" }} />
        {children}
      </div>
    </div>
  );
}
