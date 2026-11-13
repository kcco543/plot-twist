"use client";

import type { CSSProperties } from "react";
import { ArtImage } from "@/components/ui/ArtImage";
import { CornerSparkles, Sparkle } from "@/components/ui/Deco";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { worldArt } from "@/assets/manifest";
import { useI18n } from "@/i18n";
import type { World } from "@/lib/worlds";

export function WorldCard({ world, selected, onSelect }: { world: World; selected: boolean; onSelect: () => void }) {
  const { t, tl } = useI18n();
  const name = t(`worlds.list.${world.id}.name` as const);
  const tags = tl(`worlds.list.${world.id}.tags` as const);
  return (
    <button
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`px-frame px-focus px-shadow group relative flex flex-col text-left ${selected ? "px-selected -translate-y-1" : "px-lift"}`}
      style={{ "--frame": `var(--frame-${selected ? "gold-card" : world.frame})` } as CSSProperties}
    >
      {(selected || world.featured) && <CornerSparkles />}
      <div className="relative">
        <ArtImage art={worldArt[world.id]} alt={t("worlds.illustration", { name })} tagLabel={t("common.placeholder")} fit="cover" className="w-full border-2 border-outline/40" />
        <span className="absolute left-1 top-1 flex items-center gap-1 bg-white/90 px-1.5 py-1 font-label text-[10px] uppercase shadow-[1px_1px_0_rgba(91,74,134,0.25)]" style={{ color: world.accent }}>
          <PixelIcon name={world.icon} size={10} /> {world.featured ? t("worlds.featured") : t("worlds.badge")}
        </span>
        {selected && (
          <span className="absolute right-1 top-1 flex animate-pop items-center gap-1 bg-butter px-1.5 py-1 font-label text-[10px] uppercase text-ink shadow-[1px_1px_0_var(--color-butter-lo)]">
            <PixelIcon name="check" size={10} /> {t("worlds.selected")}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 px-1 pt-3 pb-1">
        <h2 className="flex items-center gap-1.5 font-head text-xl font-bold leading-tight sm:text-[22px]" style={{ color: world.accent }}>
          {name}
          {world.featured && <Sparkle size={9} twinkle className="text-butter-lo" />}
        </h2>
        <p className="text-base leading-snug text-ink">{t(`worlds.list.${world.id}.blurb` as const)}</p>
        <ul className="mt-auto flex flex-wrap gap-1.5 pt-2">
          {tags.map((tag) => (
            <li key={tag} className="border border-line bg-well px-2 py-0.5 text-sm text-ink-soft">
              {tag}
            </li>
          ))}
        </ul>
      </div>
    </button>
  );
}
