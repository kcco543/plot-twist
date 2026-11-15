"use client";

import { ArtImage } from "@/components/ui/ArtImage";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { artFor } from "@/lib/character/art";
import { bondKey } from "@/lib/story/engine";
import type { Character, StoryState } from "@/lib/types";
import { useI18n } from "@/i18n";

/**
 * Above the Character Studio editor: makes clear this is THIS world's version
 * of the character, where it came from, and the library actions.
 */
export function WorldVersionBar({
  character,
  cast,
  story,
  worldName,
  onViewOriginal,
  onSaveTemplate,
  onRemove,
}: {
  character: Character;
  cast: Character[];
  story: StoryState;
  worldName: string;
  onViewOriginal: () => void;
  onSaveTemplate: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const others = cast.filter((c) => c.id !== character.id && story.bonds[bondKey(character.id, c.id)]);
  return (
    <div className="mb-5 flex flex-col gap-3 bg-surface px-3 py-3 shadow-[inset_0_0_0_2px_var(--color-line)]" data-world-version>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-label text-xs uppercase tracking-wide text-label">{t("library.worldVersion")}</span>
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 font-label text-[10px] uppercase ${character.templateId ? "bg-lavender-hi text-label" : "bg-well text-ink-soft"}`}>
              <PixelIcon name={character.templateId ? "book" : "home"} size={9} />
              {character.templateId ? t("library.fromLibrary") : t("library.madeHere")}
            </span>
          </p>
          <p className="mt-1 text-base leading-snug text-ink-soft">{t("library.worldVersionNote", { world: worldName })}</p>
        </div>
        <p className="flex items-center gap-2 font-label text-xs uppercase text-mint-deep" role="status">
          <PixelIcon name="check" size={12} /> {t("common.autosaved")}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {character.templateId && (
          <PixelButton size="sm" variant="calm" icon="eye" onClick={onViewOriginal}>
            {t("library.viewOriginal")}
          </PixelButton>
        )}
        <PixelButton size="sm" variant="ghost" icon="book" onClick={onSaveTemplate}>
          {t("library.saveTemplate")}
        </PixelButton>
        <PixelButton size="sm" variant="ghost" icon="trash" onClick={onRemove} className="text-coral-deep">
          {t("library.removeFromWorld")}
        </PixelButton>
      </div>
      <details className="group border-t-[3px] border-dashed border-line pt-2">
        <summary className="px-focus flex min-h-9 cursor-pointer list-none items-center gap-2 font-label text-xs uppercase text-label">
          <PixelIcon name="heart" size={11} />
          {t("library.relationships")} · {others.length}
          <PixelIcon name="down" size={9} className="transition-transform group-open:rotate-180" />
        </summary>
        {others.length === 0 ? (
          <p className="pt-1 text-base text-ink-soft">{t("library.noRelationships")}</p>
        ) : (
          <ul className="flex flex-col gap-1 pt-1">
            {others.map((o) => {
              const b = story.bonds[bondKey(character.id, o.id)];
              return (
                <li key={o.id} className="flex items-center gap-2 text-base">
                  <ArtImage art={artFor(o).sprite} alt="" showTag={false} className="w-7 shrink-0" />
                  <span className="min-w-0 truncate font-bold">{o.name.trim() || t("common.unnamed")}</span>
                  <span className="ml-auto shrink-0 tabular-nums text-ink-soft">{t("library.bond", { affinity: Math.round(b.affinity), trust: Math.round(b.trust) })}</span>
                </li>
              );
            })}
          </ul>
        )}
      </details>
    </div>
  );
}
