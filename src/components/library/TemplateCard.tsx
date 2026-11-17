"use client";

import type { ReactNode } from "react";
import { ArtImage } from "@/components/ui/ArtImage";
import { artFor } from "@/lib/character/art";
import type { Character } from "@/lib/types";
import { useI18n } from "@/i18n";

/** Portrait + name + the basics, for picking a library character. */
export function TemplatePreview({ character, children, compact = false }: { character: Character; children?: ReactNode; compact?: boolean }) {
  const { t } = useI18n();
  const name = character.name.trim() || t("library.unnamedOriginal");
  const sub = [character.age.trim() && t("common.ageValue", { age: character.age.trim() }), character.identity.trim()].filter(Boolean).join(" · ");
  const about = character.personality.trim() || character.background.trim();
  return (
    <div className="flex min-w-0 gap-3">
      <div className="px-checker shrink-0 self-start border-2 border-outline/40">
        <ArtImage art={artFor(character).portrait} alt="" showTag={false} className={compact ? "w-16" : "w-20 sm:w-24"} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-head text-lg font-bold leading-tight text-ink [overflow-wrap:anywhere]">{name}</p>
        {sub && <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{sub}</p>}
        {about && !compact && <p className="line-clamp-2 text-base leading-snug text-ink [overflow-wrap:anywhere]">{about}</p>}
        {children}
      </div>
    </div>
  );
}
