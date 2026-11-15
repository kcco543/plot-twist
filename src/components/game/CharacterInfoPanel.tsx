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
import { emotionOf } from "@/lib/emotion/emotions";
import type { Character, Memory, Mood, StoryState } from "@/lib/types";
import type { MemoryPatch } from "@/lib/talk/ai/apply";
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
export function CharacterInfoPanel({
  character,
  cast,
  story,
  isDemo,
  framed = true,
  onEditMemory,
}: {
  character: Character | null;
  cast: Character[];
  story: StoryState;
  isDemo: boolean;
  framed?: boolean;
  /** Correct (patch) or forget (null) a saved memory. Omitted = read-only. */
  onEditMemory?: (characterId: string, memoryId: string, patch: MemoryPatch | null) => void;
}) {
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
            const feel = emotionOf(s);
            return (
              <p className="mt-1 flex flex-wrap gap-1">
                <span className={`inline-block px-1.5 py-0.5 text-sm ${MOOD_COLOR[s.mood]}`}>
                  <span className="font-label text-[9px] uppercase text-ink-soft">{t("play.sidebar.mood")}</span> {tx(`moods.${s.mood}`)}
                </span>
                {feel.emotion !== "neutral" && (
                  <span className="inline-block bg-lavender-hi px-1.5 py-0.5 text-sm" data-feeling={feel.emotion}>
                    <span className="font-label text-[9px] uppercase text-ink-soft">{t("play.sidebar.feeling")}</span> {tx(`emotions.${feel.emotion}`)}
                  </span>
                )}
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
            <>
              {onEditMemory && <p className="mb-2 text-xs text-ink-soft">{t("memoryEditor.help")}</p>}
              <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1" data-memory-list>
                {mems.map((m) => (
                  <MemoryItem key={m.id} m={m} onEdit={onEditMemory ? (patch) => onEditMemory(character.id, m.id, patch) : undefined} />
                ))}
              </ul>
            </>
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

/** One memory: what it was, how important, any open thread, and (in play) correct / resolve / forget. */
function MemoryItem({ m, onEdit }: { m: Memory; onEdit?: (patch: MemoryPatch | null) => void }) {
  const { t, tx } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.note ?? "");
  const [confirmForget, setConfirmForget] = useState(false);
  // Conversation memories (walk & talk, AI) are labelled by kind; story-engine ones by their event.
  const label = /^(talk|chat)\./.test(m.eventType) ? tx(`memoryEditor.kinds.${m.kind ?? "note"}`) : tx(`events.${m.eventType}`);
  const text = m.note || tx(`memories.${m.eventType}`, { with: m.withName || t("common.someone") });
  return (
    <li className="bg-well px-2 py-1.5 shadow-[inset_3px_0_0_var(--color-lavender)]" data-memory={m.id}>
      <p className="flex items-center justify-between gap-2 font-label text-[9px] uppercase text-rose">
        <span className="flex flex-wrap items-center gap-1">
          {label}
          {m.withName && <span className="normal-case text-ink-soft">· {m.withName}</span>}
          {m.source === "ai" && <span className="bg-lavender-hi px-1 text-label">AI</span>}
          {m.source === "mock" && <span className="bg-butter-hi px-1 text-ink">TEST</span>}
          {m.source === "player" && <span className="bg-mint-hi px-1 text-ink">{t("memoryEditor.edited")}</span>}
        </span>
        <span className="text-butter-lo" aria-label={`${m.importance}/3`}>
          {"★".repeat(m.importance)}
        </span>
      </p>
      {editing ? (
        <form
          className="mt-1 flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            onEdit?.({ note: draft });
            setEditing(false);
          }}
        >
          <label className="sr-only" htmlFor={`mem-${m.id}`}>
            {t("memoryEditor.textLabel")}
          </label>
          <textarea
            id={`mem-${m.id}`}
            rows={2}
            value={draft}
            maxLength={200}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            className="px-focus w-full resize-y bg-surface px-2 py-1 text-sm leading-snug shadow-[inset_0_0_0_2px_var(--color-line)]"
          />
          <div className="flex gap-2">
            <button type="submit" className="px-focus min-h-9 bg-mint-hi px-2 font-label text-[10px] uppercase shadow-[inset_0_0_0_2px_var(--color-mint)]">
              {t("memoryEditor.save")}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="px-focus min-h-9 px-2 font-label text-[10px] uppercase text-ink-soft">
              {t("memoryEditor.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-sm leading-snug">{text}</p>
      )}
      {m.thread && (
        <p className="mt-1 font-label text-[9px] uppercase">
          <span className={m.resolved ? "text-ink-mute line-through" : "text-coral"}>{tx(`memoryEditor.threads.${m.thread}`)}</span>
          <span className="text-ink-mute"> · {m.resolved ? t("memoryEditor.resolved") : t("memoryEditor.open")}</span>
        </p>
      )}
      {onEdit && !editing && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-label text-[10px] uppercase">
          <button
            type="button"
            className="px-focus min-h-8 text-label hover:text-ink"
            onClick={() => {
              setDraft(m.note ?? text);
              setEditing(true);
            }}
          >
            {t("memoryEditor.edit")}
          </button>
          {m.thread && (
            <button type="button" className="px-focus min-h-8 text-label hover:text-ink" onClick={() => onEdit({ resolved: !m.resolved })}>
              {m.resolved ? t("memoryEditor.reopen") : t("memoryEditor.markResolved")}
            </button>
          )}
          {confirmForget ? (
            <span className="flex items-center gap-2">
              <button type="button" className="px-focus min-h-8 text-coral hover:text-ink" onClick={() => onEdit(null)}>
                {t("memoryEditor.forgetConfirm")}
              </button>
              <button type="button" className="px-focus min-h-8 text-ink-soft" onClick={() => setConfirmForget(false)}>
                {t("memoryEditor.cancel")}
              </button>
            </span>
          ) : (
            <button type="button" className="px-focus min-h-8 text-ink-soft hover:text-coral" onClick={() => setConfirmForget(true)}>
              {t("memoryEditor.forget")}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
