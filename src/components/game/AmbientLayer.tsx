"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { ambientFor, ambientTiming, type AmbientItem, type AmbientSpec } from "@/lib/scene/ambient";
import { clipPathOf, pointInPolygon } from "@/lib/scene/geometry";
import type { WorldObject } from "@/lib/stage/objects";
import type { Rect } from "@/lib/stage/room";

/**
 * AMBIENT ANIMATION LAYER (rules: src/lib/scene/ambient.ts)
 * Small stepped CSS loops drawn over objects in stage art px, inside the
 * scaled stage, so they scale with the map's own pixels. React renders this
 * once per object list; the motion itself is pure CSS (transform/opacity).
 * Effects the camera can't see are paused with an IntersectionObserver whose
 * root is the viewport, and Reduce motion (the app's or the OS's) stops them
 * through the global rule in globals.css.
 *
 * Depth: an effect sits at its object's base (z = feet y, like sprites), so
 * someone walking in front of a lantern is drawn over its glow. Swaying
 * objects that are also "in front" cut-outs sway inside SceneFronts instead
 * (they keep that layer's see-through behaviour), see `swayFor`.
 */

/** CSS custom properties for one effect's timing. */
export function ambientVars(spec: AmbientSpec): CSSProperties {
  const t = ambientTiming(spec);
  return { "--amb-dur": `${t.duration}ms`, "--amb-delay": `${t.delay}ms`, "--amb-steps": t.steps, "--amb-dir": t.direction } as CSSProperties;
}

/** Stable pseudo-random numbers from an id (sparkle spots never jump between renders). */
function seeded(id: string) {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** A few spots inside the object's region (its outline when it has one). */
export function sparkleSpots(o: Pick<WorldObject, "id" | "bounds" | "shape">, n = 4): { x: number; y: number; d: number }[] {
  const rnd = seeded(o.id);
  const b = o.bounds;
  const out: { x: number; y: number; d: number }[] = [];
  for (let tries = 0; out.length < n && tries < n * 12; tries++) {
    const x = b.x0 + (0.12 + rnd() * 0.76) * (b.x1 - b.x0);
    const y = b.y0 + (0.12 + rnd() * 0.76) * (b.y1 - b.y0);
    if (o.shape && !pointInPolygon({ x, y }, o.shape)) continue;
    out.push({ x: x - b.x0, y: y - b.y0, d: rnd() });
  }
  return out;
}

const box = (b: Rect): CSSProperties => ({ left: b.x0, top: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 });

export function AmbientLayer({
  objects,
  art,
  frontIds,
  disabled = false,
}: {
  objects: WorldObject[];
  /** The stage picture (sway reuses its pixels) in stage art px. */
  art: { src: string; width: number; height: number; smooth?: boolean };
  /** Objects drawn as "in front" cut-outs: their sway happens in SceneFronts. */
  frontIds?: ReadonlySet<string>;
  /** Nothing animates (reduced motion is also handled by CSS; this removes the elements entirely). */
  disabled?: boolean;
}) {
  const items = useMemo(() => (disabled ? [] : ambientFor(objects)), [objects, disabled]);
  const byId = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]);
  const root = useRef<HTMLDivElement>(null);

  // Pause what the camera can't see. One observer for the layer; no per-frame work.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const view = el.closest<HTMLElement>("[data-stage-view]");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const t = e.target as HTMLElement;
          if (e.isIntersecting) delete t.dataset.ambPaused;
          else t.dataset.ambPaused = "";
        }
      },
      { root: view, rootMargin: "24px" },
    );
    el.querySelectorAll("[data-ambient]").forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [items]);

  if (!items.length) return null;
  return (
    <div ref={root} aria-hidden data-ambient-layer className="pointer-events-none absolute inset-0">
      {items.map((it) => {
        const o = byId.get(it.objectId);
        if (!o) return null;
        if (it.spec.kind === "sway" && frontIds?.has(o.id)) return null;
        return <Effect key={o.id} item={it} o={o} art={art} />;
      })}
    </div>
  );
}

function Effect({ item, o, art }: { item: AmbientItem; o: WorldObject; art: { src: string; width: number; height: number; smooth?: boolean } }) {
  const b = o.bounds;
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const vars = ambientVars(item.spec);
  const clip = o.shape ? { clipPath: clipPathOf(o.shape, b) } : {};
  const z = item.spec.kind === "sway" ? 1 : Math.round(b.y1);
  const common = { "data-ambient": item.spec.kind, "data-ambient-object": o.id } as const;

  switch (item.spec.kind) {
    case "ripple":
      return (
        <span {...common} className="amb absolute overflow-hidden" style={{ ...box(b), ...clip, zIndex: z }}>
          <span className="amb-ripple" style={vars} />
        </span>
      );
    case "sway":
      return (
        <span {...common} className="amb absolute overflow-hidden" style={{ ...box(b), ...clip, zIndex: z }}>
          <span
            className={`amb-sway ${art.smooth ? "" : "pixelated"}`}
            style={{
              ...vars,
              backgroundImage: `url(${JSON.stringify(art.src)})`,
              backgroundSize: `${art.width}px ${art.height}px`,
              backgroundPosition: `${-b.x0}px ${-b.y0}px`,
            }}
          />
        </span>
      );
    case "flicker": {
      const r = Math.max(8, Math.max(w, h) * 0.6);
      return <span {...common} className="amb amb-flicker absolute" style={{ ...vars, left: b.x0 + w / 2 - r, top: b.y0 + h * 0.35 - r, width: r * 2, height: r * 2, zIndex: z }} />;
    }
    case "flame": {
      const s = Math.min(14, Math.max(4, Math.round(w * 0.3)));
      return (
        <span {...common} className="amb absolute" style={{ left: b.x0 + w / 2 - s / 2, top: b.y0 + h * 0.3 - s * 1.3, width: s, height: s * 1.4, zIndex: z }}>
          <span className="amb-flame-glow" style={vars} />
          <span className="amb-flame" style={vars} />
        </span>
      );
    }
    case "twinkle":
      return (
        <span {...common} className="amb absolute" style={{ ...box(b), zIndex: z }}>
          {sparkleSpots(o).map((p, i) => (
            <span
              key={i}
              className="amb-twinkle"
              style={{ ...vars, left: Math.round(p.x) - 1, top: Math.round(p.y) - 1, "--amb-delay": `${-Math.round(ambientTiming(item.spec).duration * ((item.spec.phase + p.d) % 1))}ms` } as CSSProperties}
            />
          ))}
        </span>
      );
    case "pulse": {
      const r = Math.max(8, Math.max(w, h) * 0.6);
      return <span {...common} className="amb amb-pulse absolute" style={{ ...vars, left: b.x0 + w / 2 - r, top: b.y0 + h / 2 - r, width: r * 2, height: r * 2, zIndex: z }} />;
    }
  }
}

/** Sway timing for objects that are "in front" cut-outs (SceneFronts applies it to the cut-out itself). */
export function swayFor(objects: WorldObject[], frontIds: ReadonlySet<string>, disabled = false): Record<string, CSSProperties> {
  if (disabled) return {};
  const out: Record<string, CSSProperties> = {};
  for (const it of ambientFor(objects)) if (it.spec.kind === "sway" && frontIds.has(it.objectId)) out[it.objectId] = ambientVars(it.spec);
  return out;
}
