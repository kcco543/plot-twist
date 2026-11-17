"use client";

import { Choice } from "@/components/ui/Choice";
import { Field } from "@/components/ui/Field";
import { GENDERS, PRONOUN_CHOICES, genderOf, type GenderInfo } from "@/lib/character/gender";
import type { Character } from "@/lib/types";
import { useI18n } from "@/i18n";

/**
 * Gender and pronouns (Character Studio, identity section). Pronouns are a
 * separate choice. Saved on this character only: in a world that means this
 * world's version; in the Character Library, the original.
 */
export function GenderFields({ character, onChange }: { character: Character; onChange: (patch: Partial<Character>) => void }) {
  const { t } = useI18n();
  const g = genderOf(character);
  const set = (patch: Partial<GenderInfo>) => onChange({ gender: { ...g, ...patch } });
  return (
    <div className="flex flex-col gap-4" data-gender-fields>
      <Choice label={t("character.gender.label")} value={g.identity} onChange={(identity) => set({ identity })} options={GENDERS.map((v) => ({ value: v, label: t(`character.gender.options.${v}`) }))} />
      {g.identity === "custom" && (
        <Field label={t("character.gender.customLabel")} value={g.custom ?? ""} maxLength={60} onChange={(custom) => set({ custom })} placeholder={t("character.gender.customPlaceholder")} />
      )}
      <Choice label={t("character.pronouns.label")} value={g.pronouns} onChange={(pronouns) => set({ pronouns })} options={PRONOUN_CHOICES.map((v) => ({ value: v, label: t(`character.pronouns.options.${v}`) }))} />
      {g.pronouns === "custom" && (
        <Field label={t("character.pronouns.customLabel")} value={g.customPronouns ?? ""} maxLength={40} onChange={(customPronouns) => set({ customPronouns })} placeholder={t("character.pronouns.customPlaceholder")} />
      )}
      <p className="text-sm leading-snug text-ink-soft">{t("character.gender.note")}</p>
    </div>
  );
}
