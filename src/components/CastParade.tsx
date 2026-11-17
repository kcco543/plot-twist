"use client";

import type { CSSProperties } from "react";
import { characterArt } from "@/assets/manifest";
import { useI18n } from "@/i18n";

/**
 * Title screen: a row of the game's own placeholder characters standing on
 * the grass, so the first screen says "your characters live here" at a glance.
 * Decorative only (aria-hidden), whole-art-pixel scaling, stepped idle bob,
 * and one of them has a speech bubble. Reduced motion stops the bob.
 *
 * Positions are percentages of the hero's width, so the row spreads with the
 * window; phones show four of them, wider screens all six.
 */
const SPOTS: { left: string; sprite: number; flip?: boolean; delay: number; phone?: boolean }[] = [
  { left: "6%", sprite: 0, delay: 0 },
  { left: "17%", sprite: 4, flip: true, delay: 380, phone: true },
  { left: "28%", sprite: 2, delay: 760, phone: true },
  { left: "66%", sprite: 1, flip: true, delay: 200, phone: true },
  { left: "77%", sprite: 5, delay: 560, phone: true },
  { left: "88%", sprite: 3, flip: true, delay: 940 },
];

export function CastParade() {
  const { t } = useI18n();
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-[3%] z-[5] h-0">
      {SPOTS.map((s, i) => (
        <span
          key={i}
          className={`parade-actor absolute bottom-0 ${s.phone ? "" : "hidden sm:block"}`}
          style={{ left: s.left, "--bob-delay": `${s.delay}ms` } as CSSProperties}
        >
          {i === 2 && (
            <span className="bubble absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap">
              <span className="bubble-body block px-2 py-0.5 font-head text-[13px] font-bold text-rose sm:text-[15px]">{t("title.paradeBubble")}</span>
            </span>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element -- 32×32 pixel sprite, scaled by whole pixels */}
          <img src={characterArt[s.sprite].sprite.src} alt="" width={32} height={32} draggable={false} className="pixelated block size-16 sm:size-24" style={s.flip ? { transform: "scaleX(-1)" } : undefined} />
          <span className="parade-shadow" />
        </span>
      ))}
    </div>
  );
}
