"use client";

import type { CSSProperties } from "react";
import { artFor } from "@/lib/character/art";
import { useI18n } from "@/i18n";
import type { Character } from "@/lib/types";
import type { ActorView } from "@/lib/stage/sim";

/** Stage size and sprite size, in art pixels (320×192 room, 32×32 sprites). */
export const STAGE = { width: 320, height: 192, floorY: 176, left: 56, right: 264, sprite: 32 };

/** Max characters drawn in the scene. */
export const MAX_ON_STAGE = 6;

/**
 * Top-of-head point of a character as fractions (0–1) of the stage size.
 * Sprites, name tags, emotion effects and speech bubbles all read the same
 * live position (from the stage simulation), so everything anchored to a
 * character follows it while it walks and when the stage is resized.
 */
export function anchorOf(view: { x: number; y: number } | null | undefined): { x: number; y: number } | null {
  if (!view) return null;
  return { x: view.x / STAGE.width, y: (view.y - STAGE.sprite) / STAGE.height };
}

const byId = (actors: ActorView[]) => new Map(actors.map((a) => [a.id, a]));

/** Sprites, drawn inside the scaled stage (crisp art). Click/tap to select. Nearer characters (lower on screen) draw on top. */
export function SceneSprites({
  characters,
  actors,
  selectedId,
  onSelect,
}: {
  characters: Character[];
  actors: ActorView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const pos = byId(actors);
  return (
    <>
      {characters.slice(0, MAX_ON_STAGE).map((c) => {
        const a = pos.get(c.id);
        if (!a) return null;
        const active = c.id === selectedId;
        const art = artFor(c).sprite;
        const motion = a.body ? `body-${a.body}` : a.walking ? "body-walk" : active && a.state === "idle" ? "animate-bob" : "";
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            aria-pressed={active}
            aria-label={t("play.selectCharacter", { name: c.name.trim() || t("common.unnamed") })}
            data-actor={c.id}
            data-state={a.state}
            data-emotion={a.emotion}
            className="group absolute focus-visible:outline-1 focus-visible:outline-dashed focus-visible:outline-label"
            style={{ left: a.x - STAGE.sprite / 2, top: a.y - STAGE.sprite, width: STAGE.sprite, height: STAGE.sprite, zIndex: a.y }}
          >
            <span className="absolute bottom-0 left-1/2 h-[3px] w-6 -translate-x-1/2 bg-ink/40" aria-hidden />
            <span key={`${a.body ?? (a.walking ? "walk" : "")}:${a.bodyKey}`} className={`relative block ${motion}`} style={{ transformOrigin: "50% 100%" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={art.src}
                alt=""
                width={art.width}
                height={art.height}
                draggable={false}
                className="pixelated block"
                style={{ transform: a.facing < 0 ? "scaleX(-1)" : undefined } as CSSProperties}
              />
            </span>
          </button>
        );
      })}
    </>
  );
}

/** Name tags + selection marker, drawn in the unscaled overlay so text stays readable. */
export function SceneLabels({
  characters,
  actors,
  selectedId,
  speakingId = null,
}: {
  characters: Character[];
  actors: ActorView[];
  selectedId: string | null;
  speakingId?: string | null;
}) {
  const { t } = useI18n();
  const pos = byId(actors);
  const shown = characters.slice(0, MAX_ON_STAGE).filter((c) => pos.has(c.id));
  return (
    <>
      {shown.map((c) => {
        const a = pos.get(c.id)!;
        const active = c.id === selectedId;
        const speaking = c.id === speakingId;
        return (
          <span
            key={c.id}
            className="absolute -translate-x-1/2"
            style={{ left: `${(a.x / STAGE.width) * 100}%`, top: `${((a.y + 2) / STAGE.height) * 100}%`, zIndex: speaking ? 3 : active ? 2 : 1 }}
          >
            <span
              className={`flex max-w-24 items-center gap-1 px-1 py-[1px] font-head text-[11px] font-bold leading-tight sm:text-xs ${
                speaking ? "bg-pink-hi text-ink shadow-[inset_0_-2px_0_var(--color-pink)]" : active ? "bg-butter text-ink" : "bg-white/90 text-ink"
              }`}
            >
              {speaking && (
                <svg width="8" height="7" viewBox="0 0 4 4" shapeRendering="crispEdges" className="shrink-0 animate-blink text-rose" aria-hidden>
                  <path d="M0 0h4v2H2L1 3V2H0z" fill="currentColor" />
                </svg>
              )}
              <span className="truncate">{c.name.trim() || t("common.unnamed")}</span>
            </span>
          </span>
        );
      })}
      {shown.map((c) => {
        if (c.id !== selectedId) return null;
        const a = pos.get(c.id)!;
        return (
          <span
            key="marker"
            aria-hidden
            className="absolute -translate-x-1/2 animate-bob text-label"
            style={{ left: `${(a.x / STAGE.width) * 100}%`, top: `calc(${((a.y - STAGE.sprite) / STAGE.height) * 100}% - 16px)` }}
          >
            <svg width="12" height="10" viewBox="0 0 6 5" shapeRendering="crispEdges" fill="currentColor">
              <rect x="0" y="0" width="6" height="1" fill="var(--color-ink)" />
              <rect x="0" y="1" width="6" height="1" />
              <rect x="1" y="2" width="4" height="1" />
              <rect x="2" y="3" width="2" height="1" />
            </svg>
          </span>
        );
      })}
    </>
  );
}
