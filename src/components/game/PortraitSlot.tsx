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
export function PortraitSlot({
  character,
  onChange,
  onMakeSprite,
  onClearArt = () => gameActions.applySprite(character.id, null),
}: {
  character: Character;
  onChange: (i: number) => void;
  /** Hidden when not given (Character Library originals have no sprite maker). */
  onMakeSprite?: () => void;
  onClearArt?: () => void;
}) {
  const { t } = useI18n();
  const total = characterArt.length;
  const index = character.portrait;
  const shown = ((index % total) + total) % total;
  const art = artFor(character);
  const name = character.name;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="px-frame px-shadow px-portrait relative" style={{ "--frame": "var(--frame-portrait)" } as React.CSSProperties}>
        <div className="px-checker">
          <ArtImage art={art.portrait} alt={t("studio.portrait.alt", { name: name || t("common.unnamed") })} tagLabel={t("common.placeholder")} className="w-[144px] sm:w-[192px]" />
        </div>
      </div>
      {art.custom ? (
        <div className="flex flex-col items-center gap-2">
          <span className="bg-butter-hi px-2 py-0.5 font-label text-[10px] uppercase text-label">{t(character.portraits ? "portrait.customAvatar" : "studio.portrait.custom")}</span>
          {/* A managed portrait (versions + avatar) is changed in the Look tab, never cleared from here by accident. */}
          {(!character.portraits || !onMakeSprite) && (
            <PixelButton size="sm" variant="ghost" onClick={onClearArt}>
              {t("sprite.usePlaceholder")}
            </PixelButton>
          )}
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
      {onMakeSprite && (
        <PixelButton size="sm" variant="magic" icon="sparkle" onClick={onMakeSprite}>
          {character.portraits ? t("portrait.editShort") : t("studio.portrait.makeSprite")}
        </PixelButton>
      )}
    </div>
  );
}
