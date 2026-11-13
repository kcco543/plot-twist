"use client";

import type { CSSProperties } from "react";
import { ArtImage } from "@/components/ui/ArtImage";
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
      className={`px-frame px-focus px-shadow group flex flex-col text-left transition-transform duration-100 ${selected ? "-translate-y-1" : "hover:-translate-y-1"}`}
      style={{ "--frame": `var(--frame-${selected ? "gold-card" : world.frame})` } as CSSProperties}
    >
      <div className="relative">
        <ArtImage art={worldArt[world.id]} alt={t("worlds.illustration", { name })} tagLabel={t("common.placeholder")} fit="cover" className="w-full border-[3px] border-ink" />
        <span className="absolute left-1 top-1 flex items-center gap-1 bg-ink/85 px-1.5 py-1 font-label text-[10px] uppercase" style={{ color: world.accent }}>
          <PixelIcon name={world.icon} size={10} /> {t("worlds.badge")}
        </span>
        {selected && (
          <span className="absolute right-1 top-1 flex items-center gap-1 bg-butter px-1.5 py-1 font-label text-[10px] uppercase text-ink">
            <PixelIcon name="check" size={10} /> {t("worlds.selected")}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 px-1 pt-3 pb-1">
        <h2 className="font-head text-xl font-bold leading-tight sm:text-[22px]" style={{ color: world.accent }}>
          {name}
        </h2>
        <p className="text-base leading-snug text-cream">{t(`worlds.list.${world.id}.blurb` as const)}</p>
        <ul className="mt-auto flex flex-wrap gap-1.5 pt-2">
          {tags.map((tag) => (
            <li key={tag} className="bg-plum-800 px-2 py-0.5 text-sm text-cream-dim">
              {tag}
            </li>
          ))}
        </ul>
      </div>
    </button>
  );
}
