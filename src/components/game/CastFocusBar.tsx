"use client";

import { useEffect, useState } from "react";
import { getCharacterArt } from "@/assets/manifest";
import { useI18n } from "@/i18n";
import type { Activity } from "@/lib/camera/activity";
import type { Character } from "@/lib/types";

/**
 * QUICK FOCUS — the cast as a row of portraits over the top-left of the map.
 * Clicking someone here selects them, glides the camera to them and makes
 * them blink once, and the line under the row says what they're doing,
 * read from the game itself. Someone in another place is shown dimmed with
 * where they were last seen; clicking them never moves anyone or the camera.
 *
 * The label is re-read twice a second (not every frame): cheap, and it
 * never re-renders the rest of the play screen.
 */
export function CastFocusBar({
  cast,
  selectedId,
  elsewhere,
  activity,
  onFocus,
}: {
  /** Everyone in this world, on stage first. */
  cast: Character[];
  selectedId: string | null;
  /** Scene name for characters who are somewhere else (null = here). */
  elsewhere: (id: string) => string | null;
  activity: (id: string) => Activity;
  onFocus: (id: string) => void;
}) {
  const { t } = useI18n();
  const [shown, setShown] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const who = (shown && cast.some((c) => c.id === shown) ? shown : null) ?? selectedId ?? cast[0]?.id ?? null;

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => (n + 1) % 1_000_000), 500);
    return () => window.clearInterval(id);
  }, []);
  // The label follows the selection again a moment after you look at someone else.
  useEffect(() => {
    if (!shown) return;
    const id = window.setTimeout(() => setShown(null), 6000);
    return () => window.clearTimeout(id);
  }, [shown]);

  if (cast.length < 2) return null;
  const c = cast.find((x) => x.id === who);
  const a = c ? activity(c.id) : null;
  const label = a ? t(`play.activity.${a.key}`, { scene: "scene" in a ? a.scene : "", name: "name" in a ? a.name : "", object: "object" in a ? a.object : "" }) : "";

  return (
    <div data-camera-hud data-cast-focus className="flex max-w-full flex-col items-start gap-1">
      <div role="group" aria-label={t("play.castBar.label")} className="pointer-events-auto flex max-w-full gap-1 overflow-x-auto bg-white/85 p-1 shadow-[inset_0_-3px_0_rgb(0_0_0/0.12)] [scrollbar-width:none]">
        {cast.map((ch) => {
          const away = elsewhere(ch.id);
          const sel = ch.id === selectedId;
          const name = ch.name.trim() || t("common.unnamed");
          return (
            <button
              key={ch.id}
              type="button"
              onClick={() => {
                setShown(ch.id);
                if (!away) onFocus(ch.id);
              }}
              aria-label={`${name}: ${away ? t("play.castBar.elsewhere") : t("play.castBar.here")}`}
              aria-pressed={sel}
              title={name}
              data-focus-character={ch.id}
              data-elsewhere={away ? "" : undefined}
              className={`px-focus relative grid size-9 shrink-0 place-items-center overflow-hidden bg-well sm:size-10 ${sel ? "shadow-[0_0_0_2px_var(--color-butter-lo),inset_0_0_0_2px_var(--color-butter-hi)]" : "shadow-[inset_0_0_0_2px_var(--color-line)]"} ${away ? "opacity-45 grayscale" : ""}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- pixel portrait */}
              <img src={ch.art?.portrait ?? getCharacterArt(ch.portrait).portrait.src} alt="" width={32} height={32} draggable={false} className="pixelated size-full object-cover" />
            </button>
          );
        })}
      </div>
      {c && (
        <p className="max-w-full truncate bg-white/90 px-1.5 py-0.5 font-label text-[10px] uppercase leading-tight text-ink-soft" aria-live="polite" data-activity={a?.key}>
          <span className="text-ink">{c.name.trim() || t("common.unnamed")}</span> · {label}
        </p>
      )}
    </div>
  );
}
