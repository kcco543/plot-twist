"use client";

import { memo, type CSSProperties } from "react";
import { effectFor, glyphPixels, particlesFor, type FxSlot, type GlyphId } from "@/lib/emotion/effects";
import type { ActorView } from "@/lib/stage/sim";
import { useStageSize } from "./PixelStage";

/**
 * Emotion effects for every character, drawn inside the scaled stage in art
 * pixels (so they're as crisp as the sprites) and positioned from the same
 * live position, so they follow a walking character. The speech bubble and
 * name tags live in the overlay ABOVE this layer, so effects can never cover
 * dialogue text, and they ignore pointer input, so they never block a tap.
 *
 * - When an emotion starts: a short burst (full particles for its level).
 * - Afterwards: one quiet particle at level 2+, nothing at level 1.
 * - Reduced motion: the same symbols, standing still.
 */
export function EmotionEffects({ actors, reducedMotion }: { actors: ActorView[]; reducedMotion: boolean }) {
  const stageW = useStageSize().width;
  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 500 }} aria-hidden data-emotion-layer>
      {actors.map((a) => {
        if (a.emotion === "neutral") return null;
        const slots = a.bursting ? particlesFor(a.emotion, a.level) : a.level >= 2 ? particlesFor(a.emotion, 1) : [];
        if (!slots.length) return null;
        const def = effectFor(a.emotion)!;
        // Keep every particle on screen near the stage edges.
        const minX = Math.min(...slots.map((s) => s.x)) - 6;
        const maxX = Math.max(...slots.map((s) => s.x)) + 6;
        const headX = Math.max(2 - minX, Math.min(stageW - 2 - maxX, a.x));
        const headY = Math.max(16, a.y - 30);
        return (
          <div key={a.id} data-fx={a.emotion} className="absolute" style={{ left: headX, top: headY, zIndex: 1000 + a.y }}>
            {slots.map((s, i) => (
              <Particle key={`${a.burstKey}:${a.bursting ? "b" : "q"}:${i}`} slot={a.facing < 0 ? { ...s, x: -s.x } : s} duration={a.bursting ? def.duration : def.duration * 2.5} quiet={!a.bursting} still={reducedMotion} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

const Particle = memo(function Particle({ slot, duration, quiet, still }: { slot: FxSlot; duration: number; quiet: boolean; still: boolean }) {
  const { w, h } = glyphPixels(slot.glyph);
  return (
    <span
      className={still ? "absolute" : `absolute fx fx-${slot.motion}`}
      style={
        {
          left: slot.x - Math.floor(w / 2),
          top: slot.y - Math.floor(h / 2),
          width: w,
          height: h,
          "--fx-dur": `${duration}ms`,
          "--fx-delay": `${quiet ? 0 : slot.delay}ms`,
          opacity: quiet && still ? 0.85 : undefined,
        } as CSSProperties
      }
    >
      <GlyphSvg id={slot.glyph} />
    </span>
  );
});

/** A glyph as crisp SVG pixels (also used by the test panel's buttons). */
export function GlyphSvg({ id, scale = 1 }: { id: GlyphId; scale?: number }) {
  const { w, h, pixels } = glyphPixels(id);
  return (
    <svg width={w * scale} height={h * scale} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" className="block">
      {pixels.map((p) => (
        <rect key={`${p.x},${p.y}`} x={p.x} y={p.y} width="1" height="1" fill={p.color} />
      ))}
    </svg>
  );
}
