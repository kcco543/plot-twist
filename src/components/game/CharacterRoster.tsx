import { ArtImage } from "@/components/ui/ArtImage";
import { PixelButton } from "@/components/ui/PixelButton";
import { getCharacterArt } from "@/assets/manifest";
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
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex gap-4 overflow-x-auto p-2 pb-4 lg:flex-col lg:overflow-visible lg:p-1" aria-label="Your characters">
        {characters.map((c) => {
          const active = c.id === selectedId;
          return (
            <li key={c.id} className="shrink-0 lg:shrink">
              <button
                onClick={() => onSelect(c.id)}
                aria-current={active ? "true" : undefined}
                className="px-frame px-focus flex w-44 items-center gap-3 p-2 text-left transition-colors lg:w-full"
                style={
                  {
                    "--frame": active ? "var(--color-sun)" : "var(--color-ink-600)",
                    background: active ? "var(--color-ink-700)" : "var(--color-ink-900)",
                  } as React.CSSProperties
                }
              >
                <ArtImage art={getCharacterArt(c.portrait).portrait} alt="" showTag={false} className="size-12 shrink-0 bg-ink-950" />
                <span className="min-w-0">
                  <span className={`block truncate font-display text-[10px] uppercase ${active ? "text-sun" : "text-paper"}`}>
                    {c.name.trim() || "Unnamed"}
                  </span>
                  <span className="block truncate text-sm text-paper-dim">{c.age.trim() ? `Age ${c.age}` : "Age ?"}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <PixelButton variant="accent" size="sm" icon="plus" onClick={onAdd} className="w-full">
        New character
      </PixelButton>
    </div>
  );
}
