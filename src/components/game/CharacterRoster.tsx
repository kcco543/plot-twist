"use client";

import type { CSSProperties } from "react";
import { ArtImage } from "@/components/ui/ArtImage";
import { PixelButton } from "@/components/ui/PixelButton";
import { getCharacterArt } from "@/assets/manifest";
import { useI18n } from "@/i18n";
import type { Character } from "@/lib/types";

export function CharacterRoster({
  characters,
  selectedId,
  onSelect,
  onAdd,
}: {
  characters: Character[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      {/* Phones: horizontal swipe strip. Desktop: vertical list. */}
      <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0" aria-label={t("studio.castList")}>
        {characters.map((c) => {
          const active = c.id === selectedId;
          return (
            <li key={c.id} className="shrink-0 snap-start lg:shrink">
              <button
                onClick={() => onSelect(c.id)}
                aria-current={active ? "true" : undefined}
                className="px-frame px-focus flex w-44 items-center gap-2 text-left lg:w-full"
                style={{ "--frame": `var(--frame-${active ? "gold-card" : "card"})` } as CSSProperties}
              >
                <ArtImage art={getCharacterArt(c.portrait).sprite} alt="" showTag={false} className="w-12 shrink-0 bg-well" />
                <span className="min-w-0">
                  <span className={`block truncate font-head text-base font-bold ${active ? "text-label" : "text-ink"}`}>{c.name.trim() || t("common.unnamed")}</span>
                  <span className="block truncate text-sm text-ink-soft">{c.age.trim() ? t("common.ageValue", { age: c.age.trim() }) : t("common.ageUnknown")}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <PixelButton variant="accent" size="sm" icon="plus" onClick={onAdd} className="w-full">
        {t("studio.new")}
      </PixelButton>
    </div>
  );
}
