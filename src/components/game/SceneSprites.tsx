import { ArtImage } from "@/components/ui/ArtImage";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { getCharacterArt } from "@/assets/manifest";
import type { Character } from "@/lib/types";

/** Places character sprites along the floor of the viewport. Click to select. */
export function SceneSprites({
  characters,
  selectedId,
  onSelect,
}: {
  characters: Character[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const shown = characters.slice(0, 6);
  return (
    <>
      {shown.map((c, i) => {
        const left = shown.length === 1 ? 50 : 18 + (64 / (shown.length - 1)) * i;
        const active = c.id === selectedId;
        const name = c.name.trim() || "Unnamed";
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            aria-pressed={active}
            aria-label={`Select ${name}`}
            className="px-focus group absolute bottom-[6%] flex w-[11%] min-w-9 -translate-x-1/2 flex-col items-center"
            style={{ left: `${left}%` }}
          >
            <span className={`mb-1 text-sun ${active ? "animate-bob" : "invisible"}`} aria-hidden>
              <PixelIcon name="heart" size={12} />
            </span>
            <ArtImage
              art={getCharacterArt(c.portrait).sprite}
              alt=""
              showTag={false}
              fit="contain"
              className="aspect-[2/3] w-full transition-transform duration-100 group-hover:-translate-y-1"
            />
            <span
              className={`mt-1 max-w-[9rem] truncate px-1.5 py-0.5 font-display text-[7px] uppercase sm:text-[8px] ${
                active ? "bg-sun text-ink-950" : "bg-ink-950/85 text-paper"
              }`}
            >
              {name}
            </span>
          </button>
        );
      })}
    </>
  );
}
