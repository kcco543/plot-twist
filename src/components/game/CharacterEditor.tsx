"use client";

import { Field } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { PortraitSlot } from "./PortraitSlot";
import { useI18n } from "@/i18n";
import type { Character, CharacterTextField } from "@/lib/types";

type FieldDef = { key: CharacterTextField; multiline?: boolean; max: number };

const IDENTITY: FieldDef[] = [
  { key: "name", max: 40 },
  { key: "age", max: 20 },
  { key: "appearance", multiline: true, max: 400 },
];

const SECTIONS: { title: "inner" | "ties"; fields: FieldDef[] }[] = [
  {
    title: "inner",
    fields: [
      { key: "personality", multiline: true, max: 400 },
      { key: "background", multiline: true, max: 600 },
      { key: "goals", multiline: true, max: 400 },
      { key: "fears", multiline: true, max: 400 },
      { key: "habits", multiline: true, max: 400 },
    ],
  },
  {
    title: "ties",
    fields: [
      { key: "relationships", multiline: true, max: 600 },
      { key: "rules", multiline: true, max: 600 },
    ],
  },
];

/** User-written values are shown exactly as typed, in whatever language they were written. */
export function CharacterEditor({ character, onChange }: { character: Character; onChange: (patch: Partial<Character>) => void }) {
  const { t } = useI18n();
  const field = (f: FieldDef) => (
    <Field
      key={f.key}
      label={t(`character.fields.${f.key}.label` as const)}
      placeholder={t(`character.fields.${f.key}.placeholder` as const)}
      value={character[f.key]}
      multiline={f.multiline}
      maxLength={f.max}
      onChange={(v) => onChange({ [f.key]: v })}
    />
  );

  return (
    <div className="flex flex-col gap-8">
      <Panel title={t("studio.sections.identity")}>
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <PortraitSlot index={character.portrait} name={character.name} onChange={(portrait) => onChange({ portrait })} />
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">{IDENTITY.slice(0, 2).map(field)}</div>
            {field(IDENTITY[2])}
          </div>
        </div>
      </Panel>
      {SECTIONS.map((s) => (
        <Panel key={s.title} title={t(`studio.sections.${s.title}` as const)}>
          <div className="grid gap-4 md:grid-cols-2">{s.fields.map(field)}</div>
        </Panel>
      ))}
    </div>
  );
}
