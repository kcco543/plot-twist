"use client";

import { useId } from "react";
import { Field } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { AnalysisPanel } from "./AnalysisPanel";
import { PersonalitySliders } from "./PersonalitySliders";
import { PortraitSlot } from "./PortraitSlot";
import { SpriteStudio } from "./SpriteStudio";
import { openConflicts } from "@/lib/character/traits";
import { useI18n } from "@/i18n";
import type { Character, CharacterTextField } from "@/lib/types";

type FieldDef = { key: CharacterTextField; multiline?: boolean; max: number };

const IDENTITY: FieldDef[] = [
  { key: "name", max: 40 },
  { key: "age", max: 20 },
  { key: "identity", max: 80 },
  { key: "appearance", multiline: true, max: 400 },
];

const SECTIONS: { title: "inner" | "voice" | "ties"; fields: FieldDef[] }[] = [
  {
    title: "inner",
    fields: [
      { key: "personality", multiline: true, max: 400 },
      { key: "background", multiline: true, max: 600 },
      { key: "goals", multiline: true, max: 400 },
      { key: "fears", multiline: true, max: 400 },
    ],
  },
  {
    title: "voice",
    fields: [
      { key: "values", multiline: true, max: 400 },
      { key: "habits", multiline: true, max: 400 },
      { key: "speakingStyle", multiline: true, max: 300 },
    ],
  },
  {
    title: "ties",
    fields: [
      { key: "relationships", multiline: true, max: 600 },
      { key: "rules", multiline: true, max: 600 },
      { key: "canon", multiline: true, max: 600 },
    ],
  },
];

export type StudioTab = "profile" | "sliders" | "analysis" | "look";

/**
 * Character Studio editor: written profile, personality sliders, behavior
 * analysis and pixel sprite, each on its own tab. The written profile and
 * sliders are saved separately; nothing here rewrites what the player typed.
 */
export function CharacterEditor({
  character,
  onChange,
  tab,
  onTab,
}: {
  character: Character;
  onChange: (patch: Partial<Character>) => void;
  tab: StudioTab;
  onTab: (t: StudioTab) => void;
}) {
  const { t, tx } = useI18n();
  const base = useId();
  const setTab = onTab;
  const conflicts = openConflicts(character).length;

  const toggleLock = (key: CharacterTextField) =>
    onChange({ lockedFields: character.lockedFields.includes(key) ? character.lockedFields.filter((f) => f !== key) : [...character.lockedFields, key] });

  const field = (f: FieldDef) => {
    const label = tx(`character.fields.${f.key}.label`);
    return (
      <Field
        key={f.key}
        fieldKey={f.key}
        label={label}
        placeholder={tx(`character.fields.${f.key}.placeholder`)}
        value={character[f.key]}
        multiline={f.multiline}
        maxLength={f.max}
        onChange={(v) => onChange({ [f.key]: v })}
        lock={{
          locked: character.lockedFields.includes(f.key),
          onToggle: () => toggleLock(f.key),
          lockLabel: t("character.lock.lockField", { field: label }),
          unlockLabel: t("character.lock.unlockField", { field: label }),
          lockedText: t("character.lock.locked"),
        }}
      />
    );
  };

  const editText = (key: CharacterTextField) => {
    setTab("profile");
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-field="${key}"] textarea, [data-field="${key}"] input`);
      el?.scrollIntoView({ block: "center" });
      el?.focus();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Tabs<StudioTab>
        idBase={base}
        label={t("studio.tabsLabel")}
        value={tab}
        onChange={setTab}
        items={[
          { id: "profile", label: t("studio.tabs.profile"), icon: "pencil" },
          { id: "sliders", label: t("studio.tabs.sliders"), icon: "heart", badge: conflicts || undefined },
          { id: "analysis", label: t("studio.tabs.analysis"), icon: "sparkle", badge: character.behavior?.status === "pending" ? "!" : undefined },
          { id: "look", label: t("studio.tabs.look"), icon: "image" },
        ]}
      />

      <TabPanel id="profile" base={base} active={tab === "profile"} className="flex flex-col gap-8">
        <p className="flex items-start gap-2 text-base leading-snug text-ink-soft">
          <PixelIcon name="lock" size={12} className="mt-1 shrink-0 text-label" />
          <span>
            {t("studio.methodsNote")} {t("character.lock.hint")}
          </span>
        </p>
        <Panel title={t("studio.sections.identity")}>
          <div className="flex flex-col gap-6 md:flex-row md:items-start">
            <PortraitSlot character={character} onChange={(portrait) => onChange({ portrait })} onMakeSprite={() => setTab("look")} />
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">{IDENTITY.slice(0, 2).map(field)}</div>
              {field(IDENTITY[2])}
              {field(IDENTITY[3])}
            </div>
          </div>
        </Panel>
        {SECTIONS.map((s) => (
          <Panel key={s.title} title={tx(`studio.sections.${s.title}`)}>
            <div className="grid gap-4 md:grid-cols-2">{s.fields.map(field)}</div>
          </Panel>
        ))}
      </TabPanel>

      <TabPanel id="sliders" base={base} active={tab === "sliders"}>
        <PersonalitySliders character={character} onChange={onChange} onEditText={editText} />
      </TabPanel>

      <TabPanel id="analysis" base={base} active={tab === "analysis"}>
        <AnalysisPanel character={character} onChange={onChange} />
      </TabPanel>

      <TabPanel id="look" base={base} active={tab === "look"}>
        <SpriteStudio character={character} />
      </TabPanel>
    </div>
  );
}
