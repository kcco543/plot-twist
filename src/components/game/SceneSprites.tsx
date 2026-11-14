"use client";

import { artFor } from "@/lib/character/art";
import { useI18n } from "@/i18n";
import type { Character } from "@/lib/types";

/** Sprite slots along the floor of a 320×192 room, in art pixels. */
export const STAGE = { width: 320, height: 192, floorY: 176, left: 56, right: 264, sprite: 32 };

/** Max characters drawn in the scene. */
export const MAX_ON_STAGE = 6;

export function spriteX(i: number, count: number) {
  return count === 1 ? STAGE.width / 2 : STAGE.left + ((STAGE.right - STAGE.left) / (count - 1)) * i;
}

/**
 * Top-of-head point of a character on stage, as fractions (0–1) of the stage
 * size, or null if they aren't drawn. Sprites, name tags and speech bubbles
 * all read positions from here, so anything anchored to a character follows
 * it when the stage is resized (or, later, when characters move).
 */
export function characterAnchor(characters: Character[], id: string | null): { x: number; y: number } | null {
  if (!id) return null;
  const shown = characters.slice(0, MAX_ON_STAGE);
  const i = shown.findIndex((c) => c.id === id);
  if (i < 0) return null;
  return { x: spriteX(i, shown.length) / STAGE.width, y: (STAGE.floorY - STAGE.sprite) / STAGE.height };
}

/** Sprites, drawn inside the scaled stage (crisp art). Click/tap to select. */
export function SceneSprites({ characters, selectedId, onSelect }: { characters: Character[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const { t } = useI18n();
  const shown = characters.slice(0, MAX_ON_STAGE);
  return (
    <>
      {shown.map((c, i) => {
        const active = c.id === selectedId;
        const art = artFor(c).sprite;
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            aria-pressed={active}
            aria-label={t("play.selectCharacter", { name: c.name.trim() || t("common.unnamed") })}
            className="group absolute focus-visible:outline-1 focus-visible:outline-dashed focus-visible:outline-label"
            style={{ left: spriteX(i, shown.length) - STAGE.sprite / 2, top: STAGE.floorY - STAGE.sprite, width: STAGE.sprite, height: STAGE.sprite }}
          >
            <span className="absolute bottom-0 left-1/2 h-[3px] w-6 -translate-x-1/2 bg-ink/40" aria-hidden />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={art.src} alt="" width={art.width} height={art.height} draggable={false} className={`pixelated relative block ${active ? "animate-bob" : ""}`} />
          </button>
        );
      })}
    </>
  );
}

/** Name tags + selection marker, drawn in the unscaled overlay so text stays readable. */
export function SceneLabels({ characters, selectedId, speakingId = null }: { characters: Character[]; selectedId: string | null; speakingId?: string | null }) {
  const { t } = useI18n();
  const shown = characters.slice(0, MAX_ON_STAGE);
  return (
    <>
      {shown.map((c, i) => {
        const active = c.id === selectedId;
        const speaking = c.id === speakingId;
        const leftPct = (spriteX(i, shown.length) / STAGE.width) * 100;
        return (
          <span key={c.id} className="absolute -translate-x-1/2" style={{ left: `${leftPct}%`, top: `${((STAGE.floorY + 2) / STAGE.height) * 100}%` }}>
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
      {shown.map((c, i) =>
        c.id === selectedId ? (
          <span
            key="marker"
            aria-hidden
            className="absolute -translate-x-1/2 animate-bob text-label"
            style={{ left: `${(spriteX(i, shown.length) / STAGE.width) * 100}%`, top: `calc(${((STAGE.floorY - STAGE.sprite) / STAGE.height) * 100}% - 16px)` }}
          >
            <svg width="12" height="10" viewBox="0 0 6 5" shapeRendering="crispEdges" fill="currentColor">
              <rect x="0" y="0" width="6" height="1" fill="var(--color-ink)" />
              <rect x="0" y="1" width="6" height="1" />
              <rect x="1" y="2" width="4" height="1" />
              <rect x="2" y="3" width="2" height="1" />
            </svg>
          </span>
        ) : null,
      )}
    </>
  );
}
