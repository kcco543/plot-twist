"use client";

import type { CSSProperties } from "react";
import { ArtImage } from "@/components/ui/ArtImage";
import { CornerSparkles, Sparkle } from "@/components/ui/Deco";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { worldArt } from "@/assets/manifest";
import { useI18n } from "@/i18n";
import type { World } from "@/lib/worlds";
import { Motif } from "@/components/theme/Motif";
import { BASES } from "@/lib/theme/themes";

/**
 * One of the four world types. Every card has the same geometry (picture, ribbon, title, blurb, tags);
 * only the world's accent, rim and motifs differ, so they read as one family. `saves` = how many of the
 * player's world saves already use this type.
 */
export function WorldCard({ world, selected, onSelect, saves = 0 }: { world: World; selected: boolean; onSelect: () => void; saves?: number }) {
  const { t, tl } = useI18n();
  const name = t(`worlds.list.${world.id}.name` as const);
  const tags = tl(`worlds.list.${world.id}.tags` as const);
  return (
    <button
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      data-world-card={world.id}
      className={`world-card px-frame px-focus px-shadow group relative flex h-full flex-col text-left ${selected ? "px-selected -translate-y-1" : "px-lift"}`}
      style={{ "--frame": `var(--frame-${selected ? "gold-card" : world.frame})` } as CSSProperties}
    >
      {(selected || world.featured) && <CornerSparkles />}
      <div className="relative">
        <ArtImage art={worldArt[world.id]} alt={t("worlds.illustration", { name })} tagLabel={t("common.placeholder")} fit="cover" className="aspect-[16/10] w-full border-2 border-outline/40" />
        {/* World ribbon: the accent colour and three of the world's own motifs, under the picture. */}
        <span aria-hidden className="absolute inset-x-0 bottom-0 flex h-[calc(var(--u)*5)] items-center justify-end gap-1.5 px-2 text-white" style={{ background: world.accent }}>
          {BASES[world.id].vocabulary.slice(-3).map((m) => (
            <Motif key={m} id={m} size={10} />
          ))}
        </span>
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
        <p className={`font-label text-[10px] uppercase ${saves ? "text-mint-deep" : "text-ink-mute"}`} data-world-saves={saves}>
          <PixelIcon name={saves ? "check" : "plus"} size={9} className="mr-1 inline-block align-[-1px]" />
          {saves === 0 ? t("worlds.savesNone") : saves === 1 ? t("worlds.savesOne") : t("worlds.saves", { count: saves })}
        </p>
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
