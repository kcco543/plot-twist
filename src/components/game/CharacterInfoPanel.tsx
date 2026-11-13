import Link from "next/link";
import { ArtImage } from "@/components/ui/ArtImage";
import { Panel } from "@/components/ui/Panel";
import { getCharacterArt } from "@/assets/manifest";
import type { Character } from "@/lib/types";

const ROWS: { key: keyof Character; label: string }[] = [
  { key: "personality", label: "Personality" },
  { key: "goals", label: "Goals" },
  { key: "fears", label: "Fears" },
  { key: "relationships", label: "Relationships" },
];

export function CharacterInfoPanel({ character, isDemo }: { character: Character | null; isDemo: boolean }) {
  return (
    <Panel title="Character" as="aside" className="flex flex-col">
      {character ? (
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-4">
            <div className="px-frame px-checker shrink-0 p-1" style={{ "--frame": "var(--color-sun)" } as React.CSSProperties}>
              <ArtImage art={getCharacterArt(character.portrait).portrait} alt="" showTag={false} className="size-16" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-display text-xs uppercase text-sun">{character.name.trim() || "Unnamed"}</p>
              <p className="text-base text-paper-dim">{character.age.trim() ? `Age ${character.age}` : "Age unknown"}</p>
            </div>
          </div>
          <dl className="flex flex-col gap-3">
            {ROWS.map(({ key, label }) => (
              <div key={key}>
                <dt className="font-display text-[8px] uppercase text-twist">{label}</dt>
                <dd className="line-clamp-3 text-base leading-snug text-paper">{String(character[key]).trim() || <span className="text-ink-400">Not written yet</span>}</dd>
              </div>
            ))}
          </dl>
          {isDemo ? (
            <p className="border-t-4 border-ink-950 pt-3 text-sm text-paper-dim">
              Demo character.{" "}
              <Link href="/studio" className="px-focus text-sun underline underline-offset-4 hover:text-paper">
                Create your own cast
              </Link>
            </p>
          ) : (
            <Link href="/studio" className="px-focus border-t-4 border-ink-950 pt-3 font-display text-[9px] uppercase text-sun hover:text-paper">
              Edit in studio ›
            </Link>
          )}
        </div>
      ) : (
        <p className="p-4 text-base text-paper-dim">Select a character in the scene.</p>
      )}
    </Panel>
  );
}
