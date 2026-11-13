"use client";

import { ArtImage } from "@/components/ui/ArtImage";
import { PixelButton } from "@/components/ui/PixelButton";
import { characterArt, getCharacterArt } from "@/assets/manifest";
import { useI18n } from "@/i18n";

/**
 * Portrait frame (96×96 art shown at 2×). Today it cycles placeholder portraits.
 * A pixel editor or AI portrait generator can render into this same frame later
 * and store its result on the character instead of an index.
 */
export function PortraitSlot({ index, name, onChange }: { index: number; name: string; onChange: (i: number) => void }) {
  const { t } = useI18n();
  const total = characterArt.length;
  const shown = ((index % total) + total) % total;
  const art = getCharacterArt(index);
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="px-frame px-shadow" style={{ "--frame": "var(--frame-gold)" } as React.CSSProperties}>
        <div className="px-checker">
          <ArtImage art={art.portrait} alt={t("studio.portrait.alt", { name: name || t("common.unnamed") })} tagLabel={t("common.placeholder")} className="w-[144px] sm:w-[192px]" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <PixelButton size="sm" variant="ghost" icon="left" aria-label={t("studio.portrait.prev")} onClick={() => onChange(shown - 1)} className="min-w-11" />
        <span className="min-w-14 text-center font-label text-xs text-cream-dim tabular-nums" aria-live="polite">
          {t("studio.portrait.count", { n: shown + 1, total })}
        </span>
        <PixelButton size="sm" variant="ghost" icon="right" aria-label={t("studio.portrait.next")} onClick={() => onChange(shown + 1)} className="min-w-11" />
      </div>
      <p className="max-w-52 text-center text-sm leading-snug text-plum-300">{t("studio.portrait.note")}</p>
    </div>
  );
}
