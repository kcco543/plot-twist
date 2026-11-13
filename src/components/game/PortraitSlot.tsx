"use client";

import { ArtImage } from "@/components/ui/ArtImage";
import { PixelButton } from "@/components/ui/PixelButton";
import { characterArt } from "@/assets/manifest";
import { artFor } from "@/lib/character/art";
import { gameActions } from "@/lib/gameStore";
import type { Character } from "@/lib/types";
import { useI18n } from "@/i18n";

/**
 * Portrait frame (96×96 art shown at 2×). Shows the character's custom pixel
 * art when they have some, otherwise cycles placeholder portraits.
 */
export function PortraitSlot({ character, onChange, onMakeSprite }: { character: Character; onChange: (i: number) => void; onMakeSprite: () => void }) {
  const { t } = useI18n();
  const total = characterArt.length;
  const index = character.portrait;
  const shown = ((index % total) + total) % total;
  const art = artFor(character);
  const name = character.name;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="px-frame px-shadow" style={{ "--frame": "var(--frame-gold)" } as React.CSSProperties}>
        <div className="px-checker">
          <ArtImage art={art.portrait} alt={t("studio.portrait.alt", { name: name || t("common.unnamed") })} tagLabel={t("common.placeholder")} className="w-[144px] sm:w-[192px]" />
        </div>
      </div>
      {art.custom ? (
        <div className="flex flex-col items-center gap-2">
          <span className="bg-butter-hi px-2 py-0.5 font-label text-[10px] uppercase text-label">{t("studio.portrait.custom")}</span>
          <PixelButton size="sm" variant="ghost" onClick={() => gameActions.applySprite(character.id, null)}>
            {t("sprite.usePlaceholder")}
          </PixelButton>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <PixelButton size="sm" variant="ghost" icon="left" aria-label={t("studio.portrait.prev")} onClick={() => onChange(shown - 1)} className="min-w-11" />
          <span className="min-w-14 text-center font-label text-xs text-ink-soft tabular-nums" aria-live="polite">
            {t("studio.portrait.count", { n: shown + 1, total })}
          </span>
          <PixelButton size="sm" variant="ghost" icon="right" aria-label={t("studio.portrait.next")} onClick={() => onChange(shown + 1)} className="min-w-11" />
        </div>
      )}
      <PixelButton size="sm" variant="magic" icon="sparkle" onClick={onMakeSprite}>
        {t("studio.portrait.makeSprite")}
      </PixelButton>
    </div>
  );
}
