"use client";
import { clipPathOf } from "@/lib/scene/geometry";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { Rect } from "@/lib/stage/room";
import { LoadingDots } from "@/components/ui/LoadingDots";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { useI18n } from "@/i18n";

/**
 * DEPTH FOR GENERATED MAPS
 * Solid objects marked "in front" are drawn a second time, as a cut-out of
 * the same picture, ABOVE characters whose feet are behind the object's base
 * (z-order = feet y, the same rule the sprites use). Someone walking behind
 * the bar counter is hidden by it; someone in front of it is drawn over it.
 * Drawn in stage art px inside the scaled stage.
 *
 * Characters must stay readable (PIXEL_ART_STYLE_GUIDE.md §11): while
 * someone is behind a cut-out, it turns see-through so they never vanish.
 * The check runs in its own animation frame loop and only writes opacity,
 * so it never re-renders React.
 */
export const OCCLUDED_OPACITY = 0.45;

/** Is a character whose feet are at `p` hidden behind this cut-out? */
export function hiddenBehind(p: { x: number; y: number }, f: { bounds: Rect; baseY: number }): boolean {
  // A sprite is ~18 px wide and ~28 px tall above its feet.
  return p.y < f.baseY && p.y > f.bounds.y0 + 4 && p.x > f.bounds.x0 - 6 && p.x < f.bounds.x1 + 6;
}

export function SceneFronts({
  src,
  size,
  fronts,
  pixelated = false,
  stage,
  actorIds = [],
  sway = {},
}: {
  src: string;
  size: { width: number; height: number };
  fronts: { id: string; bounds: Rect; baseY: number; shape?: { x: number; y: number }[] }[];
  /** The map is on the art-pixel grid: draw the cut-outs with nearest-neighbour pixels like the map itself. */
  pixelated?: boolean;
  /** Characters on stage, to fade cut-outs that hide someone. */
  stage?: { position: (id: string) => { x: number; y: number } | null };
  actorIds?: string[];
  /** Cut-outs that sway (ambient animation): their timing vars, by object id. */
  sway?: Record<string, CSSProperties>;
}) {
  const refs = useRef(new Map<string, HTMLSpanElement>());
  const live = useRef({ stage, actorIds, fronts });
  live.current = { stage, actorIds, fronts };
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const { stage: s, actorIds: ids, fronts: fs } = live.current;
      if (s)
        for (const f of fs) {
          const el = refs.current.get(f.id);
          if (!el) continue;
          const hides = ids.some((id) => {
            const p = s.position(id);
            return !!p && hiddenBehind(p, f);
          });
          const want = hides ? String(OCCLUDED_OPACITY) : "1";
          if (el.style.opacity !== want) el.style.opacity = want;
        }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <>
      {fronts.map((f) => (
        <span
          key={f.id}
          ref={(el) => {
            if (el) refs.current.set(f.id, el);
            else refs.current.delete(f.id);
          }}
          aria-hidden
          data-scene-front={f.id}
          className={`${pixelated ? "pixelated " : ""}${sway[f.id] ? "amb-sway " : ""}pointer-events-none absolute transition-opacity duration-200`}
          style={{
            ...sway[f.id],
            left: f.bounds.x0,
            top: f.bounds.y0,
            width: f.bounds.x1 - f.bounds.x0,
            height: f.bounds.y1 - f.bounds.y0,
            zIndex: Math.round(f.baseY),
            backgroundImage: `url(${JSON.stringify(src)})`,
            backgroundSize: `${size.width}px ${size.height}px`,
            backgroundPosition: `${-f.bounds.x0}px ${-f.bounds.y0}px`,
            // Drawn outline: only that part of the picture covers characters behind it.
            ...(f.shape ? { clipPath: clipPathOf(f.shape, f.bounds) } : {}),
          }}
        />
      ))}
    </>
  );
}

/** Covers the stage while the selected map is read from the browser's storage. */
export function SceneLoading() {
  const { t } = useI18n();
  return (
    <div role="status" data-scene-loading className="absolute inset-0 grid place-items-center bg-surface" style={{ zIndex: 900 }}>
      <span className="flex items-center gap-1 bg-white/95 px-2 py-1 font-label text-[6px] uppercase text-label">
        {t("playArea.loadingMap")} <LoadingDots />
      </span>
    </div>
  );
}

/** A one-line notice above the stage (missing map, first-guess floor). */
export function SceneNotice({ tone = "info", children, action }: { tone?: "info" | "warn"; children: ReactNode; action?: ReactNode }) {
  return (
    <p
      data-scene-notice={tone}
      className={`content-block plain-pad-x mb-3 flex flex-wrap items-center gap-2 py-2 text-base text-ink-soft ${
        tone === "warn" ? "bg-peach-hi shadow-[inset_4px_0_0_var(--color-peach-lo)]" : "bg-butter-hi shadow-[inset_4px_0_0_var(--color-butter-lo)]"
      }`}
    >
      <PixelIcon name={tone === "warn" ? "map" : "pencil"} size={12} className="shrink-0 text-label" />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </p>
  );
}
