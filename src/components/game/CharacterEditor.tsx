import { Field } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { PortraitSlot } from "./PortraitSlot";
import type { Character, CharacterTextField } from "@/lib/types";

type FieldDef = { key: CharacterTextField; label: string; placeholder: string; multiline?: boolean; max: number };

const IDENTITY: FieldDef[] = [
  { key: "name", label: "Name", placeholder: "e.g. Juniper Vale", max: 40 },
  { key: "age", label: "Age", placeholder: "e.g. 19, ancient, unknown", max: 20 },
  { key: "appearance", label: "Appearance", placeholder: "What do people notice first?", multiline: true, max: 400 },
];

const SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "Inner life",
    fields: [
      { key: "personality", label: "Personality", placeholder: "Curious, impatient, kind in a loud way...", multiline: true, max: 400 },
      { key: "background", label: "Background", placeholder: "Where do they come from? What happened?", multiline: true, max: 600 },
      { key: "goals", label: "Goals", placeholder: "What do they want more than anything?", multiline: true, max: 400 },
      { key: "fears", label: "Fears", placeholder: "What would they never admit to being scared of?", multiline: true, max: 400 },
      { key: "habits", label: "Habits", placeholder: "Little things they do without thinking.", multiline: true, max: 400 },
    ],
  },
  {
    title: "Ties & rules",
    fields: [
      { key: "relationships", label: "Relationships", placeholder: "Friends, rivals, family, unfinished business...", multiline: true, max: 600 },
      {
        key: "rules",
        label: "Character rules & boundaries",
        placeholder: "Things this character would NEVER do, or topics the story should avoid.",
        multiline: true,
        max: 600,
      },
    ],
  },
];

export function CharacterEditor({ character, onChange }: { character: Character; onChange: (patch: Partial<Character>) => void }) {
  const field = (f: FieldDef) => (
    <Field
      key={f.key}
      label={f.label}
      value={character[f.key]}
      placeholder={f.placeholder}
      multiline={f.multiline}
      maxLength={f.max}
      onChange={(v) => onChange({ [f.key]: v })}
    />
  );

  return (
    <div className="flex flex-col gap-8">
      <Panel title="Identity">
        <div className="flex flex-col gap-6 p-5 md:flex-row md:items-start">
          <PortraitSlot index={character.portrait} name={character.name} onChange={(portrait) => onChange({ portrait })} />
          <div className="flex flex-1 flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">{IDENTITY.slice(0, 2).map(field)}</div>
            {field(IDENTITY[2])}
          </div>
        </div>
      </Panel>
      {SECTIONS.map((s) => (
        <Panel key={s.title} title={s.title}>
          <div className="grid gap-5 p-5 md:grid-cols-2">{s.fields.map(field)}</div>
        </Panel>
      ))}
    </div>
  );
}
