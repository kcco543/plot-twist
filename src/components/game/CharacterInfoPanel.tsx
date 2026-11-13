"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ArtImage } from "@/components/ui/ArtImage";
import { Panel } from "@/components/ui/Panel";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { artFor } from "@/lib/character/art";
import { approvedBehavior } from "@/lib/character/model";
import { bondKey, neutralState } from "@/lib/story/engine";
import type { Character, Mood, StoryState } from "@/lib/types";
import { useI18n } from "@/i18n";

const ROWS = ["identity", "personality", "goals", "fears", "relationships"] as const;

export const MOOD_COLOR: Record<Mood, string> = {
  calm: "bg-mint-hi",
  happy: "bg-butter-hi",
  anxious: "bg-periwinkle-hi",
  irritated: "bg-peach-hi",
  sad: "bg-well",
  excited: "bg-pink-hi",
  suspicious: "bg-lavender-hi",
  embarrassed: "bg-pink-hi",
};

function Meter({ value, label }: { value: number; label: string }) {
  // -100…100, drawn from the middle.
  const pct = Math.abs(value) / 2;
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 font-label text-[9px] uppercase text-ink-soft">{label}</span>
      <span className="relative h-2 flex-1 bg-well" role="meter" aria-label={label} aria-valuemin={-100} aria-valuemax={100} aria-valuenow={value}>
        <span className="absolute inset-y-0 left-1/2 w-px bg-line" />
        <span className={`absolute inset-y-0 ${value >= 0 ? "left-1/2 bg-mint-lo" : "right-1/2 bg-coral"}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="w-8 text-right font-label text-[9px] tabular-nums text-ink-soft">{value > 0 ? `+${value}` : value}</span>
    </div>
  );
}

type SideTab = "about" | "state" | "memories";

/**
 * Character sheet for Play Mode. Essentials (portrait, name, mood) always
 * show; the rest lives in small tabs so the game viewport gets the space.
 * Used as the desktop sidebar and inside the phone bottom sheet.
 */
export function CharacterInfoPanel({ character, cast, story, isDemo, framed = true }: { character: Character | null; cast: Character[]; story: StoryState; isDemo: boolean; framed?: boolean }) {
  const { t, tx } = useI18n();
  const base = useId();
  const [tab, setTab] = useState<SideTab>("about");

  const body = character ? (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="px-frame shrink-0" style={{ "--frame": "var(--frame-gold)" } as React.CSSProperties}>
          <div className="px-checker">
            <ArtImage art={artFor(character).portrait} alt="" showTag={false} className="w-16" />
          </div>
        </div>
        <div className="min-w-0">
          <p className="truncate font-head text-lg font-bold leading-tight text-label">{character.name.trim() || t("common.unnamed")}</p>
          <p className="truncate text-sm text-ink-soft">{character.age.trim() ? t("common.ageValue", { age: character.age.trim() }) : t("common.ageUnknown")}</p>
          {(() => {
            const s = story.characters[character.id] ?? neutralState();
            return (
              <p className={`mt-1 inline-block px-1.5 py-0.5 text-sm ${MOOD_COLOR[s.mood]}`}>
                <span className="font-label text-[9px] uppercase text-ink-soft">{t("play.sidebar.mood")}</span> {tx(`moods.${s.mood}`)}
              </p>
            );
          })()}
        </div>
      </div>
      <p className="flex items-center gap-1.5 font-label text-[9px] uppercase text-ink-soft">
        <PixelIcon name={approvedBehavior(character) ? "check" : "heart"} size={9} className={approvedBehavior(character) ? "text-mint-deep" : "text-label"} />
        {approvedBehavior(character) ? t("play.sidebar.behaviorApproved") : t("play.sidebar.behaviorNone")}
      </p>

      <Tabs<SideTab>
        idBase={base}
        size="sm"
        label={t("play.sidebar.more", { name: character.name.trim() || t("common.unnamed") })}
        value={tab}
        onChange={setTab}
        items={[
          { id: "about", label: t("play.sidebar.tabs.about") },
          { id: "state", label: t("play.sidebar.tabs.state") },
          { id: "memories", label: t("play.sidebar.tabs.memories") },
        ]}
      />

      <TabPanel id="about" base={base} active={tab === "about"}>
        <dl className="grid gap-2.5">
          {ROWS.filter((k) => k !== "identity" || character.identity.trim()).map((key) => (
            <div key={key} className="min-w-0">
              <dt className="font-label text-[10px] uppercase text-rose">{tx(`character.fields.${key}.label`)}</dt>
              <dd className="line-clamp-3 text-base leading-snug text-ink">{character[key].trim() || <span className="text-ink-mute">{t("common.notWritten")}</span>}</dd>
            </div>
          ))}
        </dl>
      </TabPanel>

      <TabPanel id="state" base={base} active={tab === "state"}>
        <p className="mb-2 font-label text-[10px] uppercase text-rose">{t("play.sidebar.bonds")}</p>
        {(() => {
          const others = cast.filter((c) => c.id !== character.id && story.bonds[bondKey(c.id, character.id)]);
          if (others.length === 0) return <p className="text-base text-ink-mute">{t("play.sidebar.noBonds")}</p>;
          return (
            <ul className="flex flex-col gap-3">
              {others.map((o) => {
                const b = story.bonds[bondKey(o.id, character.id)];
                return (
                  <li key={o.id} className="flex flex-col gap-1">
                    <span className="truncate font-head text-sm font-bold">{o.name.trim() || t("common.unnamed")}</span>
                    <Meter value={b.affinity} label={t("play.sidebar.affinity")} />
                    <Meter value={b.trust} label={t("play.sidebar.trust")} />
                  </li>
                );
              })}
            </ul>
          );
        })()}
      </TabPanel>

      <TabPanel id="memories" base={base} active={tab === "memories"}>
        {(() => {
          const mems = [...(story.characters[character.id]?.memories ?? [])].reverse();
          if (mems.length === 0) return <p className="text-base text-ink-mute">{t("play.sidebar.noMemories")}</p>;
          return (
            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
              {mems.map((m) => (
                <li key={m.id} className="bg-well px-2 py-1.5 shadow-[inset_3px_0_0_var(--color-lavender)]">
                  <p className="flex items-center justify-between gap-2 font-label text-[9px] uppercase text-rose">
                    <span>{tx(`events.${m.eventType}`)}</span>
                    <span className="text-butter-lo" aria-label={`${m.importance}/3`}>
                      {"★".repeat(m.importance)}
                    </span>
                  </p>
                  <p className="text-sm leading-snug">{m.note || tx(`memories.${m.eventType}`, { with: m.withName || t("common.someone") })}</p>
                </li>
              ))}
            </ul>
          );
        })()}
      </TabPanel>

      <div className="border-t-[3px] border-dashed border-line pt-2">
        {isDemo ? (
          <p className="text-sm text-ink-soft">
            {t("play.demoCharacter")}{" "}
            <Link href="/studio" className="px-focus text-label underline underline-offset-4 hover:text-ink">
              {t("play.createOwn")}
            </Link>
          </p>
        ) : (
          <Link href="/studio" className="px-focus inline-flex min-h-11 items-center gap-1 font-label text-xs uppercase text-label hover:text-ink">
            <PixelIcon name="pencil" size={11} /> {t("play.editInStudio")}
          </Link>
        )}
      </div>
    </div>
  ) : (
    <p className="text-base text-ink-soft">{t("play.selectInScene")}</p>
  );

  if (!framed) return body;
  return (
    <Panel title={t("play.character")} as="aside" className="min-w-0">
      {body}
    </Panel>
  );
}
