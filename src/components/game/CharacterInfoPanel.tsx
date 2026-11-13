"use client";

import Link from "next/link";
import { ArtImage } from "@/components/ui/ArtImage";
import { Panel } from "@/components/ui/Panel";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { getCharacterArt } from "@/assets/manifest";
import { useI18n } from "@/i18n";
import type { Character } from "@/lib/types";

const ROWS = ["personality", "goals", "fears", "relationships"] as const;

export function CharacterInfoPanel({ character, isDemo }: { character: Character | null; isDemo: boolean }) {
  const { t } = useI18n();
  return (
    <Panel title={t("play.character")} as="aside" className="min-w-0">
      {character ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="px-frame shrink-0" style={{ "--frame": "var(--frame-gold)" } as React.CSSProperties}>
              <div className="px-checker">
                <ArtImage art={getCharacterArt(character.portrait).portrait} alt="" showTag={false} className="w-[72px] sm:w-24" />
              </div>
            </div>
            <div className="min-w-0">
              <p className="truncate font-head text-xl font-bold text-butter">{character.name.trim() || t("common.unnamed")}</p>
              <p className="text-base text-cream-dim">{character.age.trim() ? t("common.ageValue", { age: character.age.trim() }) : t("common.ageUnknown")}</p>
            </div>
          </div>
          <dl className="grid gap-2.5 min-[480px]:grid-cols-2 lg:grid-cols-1">
            {ROWS.map((key) => (
              <div key={key} className="min-w-0">
                <dt className="font-label text-[10px] uppercase text-pink">{t(`character.fields.${key}.label` as const)}</dt>
                <dd className="line-clamp-3 text-base leading-snug text-cream">{character[key].trim() || <span className="text-plum-300">{t("common.notWritten")}</span>}</dd>
              </div>
            ))}
          </dl>
          <div className="border-t-[3px] border-dashed border-plum-600 pt-2">
            {isDemo ? (
              <p className="text-sm text-cream-dim">
                {t("play.demoCharacter")}{" "}
                <Link href="/studio" className="px-focus text-butter underline underline-offset-4 hover:text-cream">
                  {t("play.createOwn")}
                </Link>
              </p>
            ) : (
              <Link href="/studio" className="px-focus inline-flex min-h-11 items-center gap-1 font-label text-xs uppercase text-butter hover:text-cream">
                <PixelIcon name="pencil" size={11} /> {t("play.editInStudio")}
              </Link>
            )}
          </div>
        </div>
      ) : (
        <p className="text-base text-cream-dim">{t("play.selectInScene")}</p>
      )}
    </Panel>
  );
}
