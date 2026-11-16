"use client";

import type { ReactNode } from "react";
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
 */
export function SceneFronts({ src, size, fronts }: { src: string; size: { width: number; height: number }; fronts: { id: string; bounds: Rect; baseY: number }[] }) {
  return (
    <>
      {fronts.map((f) => (
        <span
          key={f.id}
          aria-hidden
          data-scene-front={f.id}
          className="pointer-events-none absolute"
          style={{
            left: f.bounds.x0,
            top: f.bounds.y0,
            width: f.bounds.x1 - f.bounds.x0,
            height: f.bounds.y1 - f.bounds.y0,
            zIndex: Math.round(f.baseY),
            backgroundImage: `url(${JSON.stringify(src)})`,
            backgroundSize: `${size.width}px ${size.height}px`,
            backgroundPosition: `${-f.bounds.x0}px ${-f.bounds.y0}px`,
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
