import type { CSSProperties } from "react";
import { ArtImage } from "@/components/ui/ArtImage";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { worldArt } from "@/assets/manifest";
import type { World } from "@/lib/worlds";

export function WorldCard({ world, selected, onSelect }: { world: World; selected: boolean; onSelect: () => void }) {
  return (
    <button
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`px-panel px-focus group flex flex-col text-left transition-transform duration-100 hover:-translate-y-1 ${selected ? "-translate-y-1" : ""}`}
      style={
        {
          "--frame": selected ? "var(--color-sun)" : world.accent,
          "--drop": selected ? world.accent : "var(--color-ink-950)",
        } as CSSProperties
      }
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2" style={{ background: world.accent, color: world.accentInk }}>
        <span className="flex items-center gap-2 font-display text-[9px] uppercase">
          <PixelIcon name={world.icon} size={14} />
          World
        </span>
        {selected && (
          <span className="flex items-center gap-1 bg-ink-950 px-2 py-1 font-display text-[8px] uppercase text-sun">
            <PixelIcon name="check" size={10} /> Selected
          </span>
        )}
      </div>
      <ArtImage art={worldArt[world.id]} alt={`${world.name} illustration`} className="aspect-[8/5] border-y-4 border-ink-950" />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <h2 className="font-display text-sm uppercase leading-snug" style={{ color: world.accent }}>
          {world.name}
        </h2>
        <p className="text-lg leading-snug text-paper">{world.blurb}</p>
        <ul className="mt-auto flex flex-wrap gap-2 pt-2">
          {world.tags.map((t) => (
            <li key={t} className="border-2 border-ink-600 px-2 py-0.5 text-sm text-paper-dim">
              {t}
            </li>
          ))}
        </ul>
      </div>
    </button>
  );
}
