"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { PixelButton } from "@/components/ui/PixelButton";
import { Choice, Toggle } from "@/components/ui/Choice";
import { EMOTIONS, type Emotion, type EmotionLevel } from "@/lib/emotion/emotions";
import { effectFor } from "@/lib/emotion/effects";
import { gameActions } from "@/lib/gameStore";
import type { ActionResult, StageAction } from "@/lib/stage/actions";
import type { StageSim } from "@/lib/stage/sim";
import { useStageSnapshot } from "@/lib/stage/useStage";
import type { Character } from "@/lib/types";
import { useI18n } from "@/i18n";
import { GlyphSvg } from "./EmotionEffects";

/**
 * Emotion & movement test panel (Settings → "Emotion & movement test panel").
 * Every button sends the same validated stage actions the story uses, so what
 * you see here is exactly what the game rules allow, and a refusal says why.
 */
export function StageTestPanel({
  stage,
  cast,
  selectedId,
  onClose,
  compact = false,
}: {
  /** Narrow column (desktop sidebar): one or two buttons per row. */
  compact?: boolean;
  stage: StageSim;
  cast: Character[];
  selectedId: string | null;
  onClose: () => void;
}) {
  const { t, tx } = useI18n();
  const snap = useStageSnapshot(stage);
  const [level, setLevel] = useState<EmotionLevel>(2);
  const [react, setReact] = useState(true);
  const [targetPick, setTargetPick] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);

  const nameOf = (id: string | null | undefined) => {
    const c = cast.find((x) => x.id === id);
    return c ? c.name.trim() || t("common.unnamed") : "";
  };
  const actor = cast.find((c) => c.id === selectedId) ?? cast[0] ?? null;
  const others = useMemo(() => cast.filter((c) => c.id !== actor?.id), [cast, actor?.id]);
  // Default target: whoever is nearest. A pick that is no longer valid falls back to that.
  const targetId = others.some((c) => c.id === targetPick) ? targetPick : actor ? stage.nearest(actor.id) : null;

  const report = (r: ActionResult, extra?: string) => {
    const action = r.action ? t(`play.test.actions.${r.action.type}` as "play.test.actions.approach") + (extra ? ` (${extra})` : "") : "";
    const name = nameOf(r.action?.actor ?? actor?.id);
    setMessage(
      r.ok
        ? t("play.test.result.ok", { name, action, note: tx(`play.test.notes.${r.note}`) })
        : t("play.test.result.refused", { name, action, reason: tx(`play.test.reasons.${r.reason}`) }),
    );
  };

  const send = (a: StageAction, extra?: string) => {
    const r = stage.request(a, "test");
    report(r, extra);
    return r;
  };

  /** Show an emotion: the stage shows it now, and it's saved as the character's current feeling. */
  const emote = (id: string, emotion: Emotion, lvl: EmotionLevel = level, withMove = react, target = targetId) => {
    const at = Date.now();
    stage.markEmotionStamp(id, at);
    const r = send({ type: "show_emotion", actor: id, emotion, level: lvl, react: withMove, target: target && target !== id ? target : undefined }, tx(`emotions.${emotion}`));
    if (r.ok) gameActions.setEmotion(id, emotion, lvl, at);
  };

  return (
    <Panel className="w-full" aria-label={t("play.test.title")}>
      <div data-test-panel />
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-head text-xl font-bold">{t("play.test.title")}</h2>
            <p className="mt-1 text-base leading-snug text-ink-soft">{t("play.test.intro")}</p>
          </div>
          <PixelButton size="sm" variant="ghost" icon="close" onClick={onClose} aria-label={t("play.test.close")} />
        </div>

        <div className={`grid gap-3 ${compact ? "" : "sm:grid-cols-2"}`}>
          <div>
            <p className="font-label text-xs uppercase tracking-wide text-label">{t("play.test.who")}</p>
            <p className="mt-1 bg-butter px-2 py-1 font-head text-lg font-bold">{actor ? nameOf(actor.id) : "—"}</p>
          </div>
          <label className="flex flex-col">
            <span className="font-label text-xs uppercase tracking-wide text-label">{t("play.test.target")}</span>
            <select
              className="px-input mt-1 min-h-11 bg-white px-2 text-base"
              value={targetId ?? ""}
              onChange={(e) => setTargetPick(e.target.value)}
              disabled={others.length === 0}
            >
              {others.length === 0 && <option value="">{t("play.test.nobody")}</option>}
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {nameOf(c.id)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* 1 · Emotions */}
        <section className="flex flex-col gap-3 border-t-[3px] border-dashed border-line pt-4">
          <p className="font-label text-xs uppercase tracking-wide text-label">{t("play.test.emotionsTitle")}</p>
          <div className={`grid gap-2 ${compact ? "grid-cols-1" : "grid-cols-2 min-[480px]:grid-cols-3 lg:grid-cols-4"}`}>
            {EMOTIONS.map((e) => {
              const fx = effectFor(e);
              return (
                <PixelButton key={e} size="sm" variant={e === "neutral" ? "ghost" : "calm"} disabled={!actor} onClick={() => actor && emote(actor.id, e)} className="min-w-0 justify-start">
                  <span className="flex items-center gap-2">
                    <span className="grid size-6 shrink-0 place-items-center">{fx ? <GlyphSvg id={fx.icon} scale={2} /> : <span className="block size-2 bg-ink-mute" />}</span>
                    {tx(`emotions.${e}`)}
                  </span>
                </PixelButton>
              );
            })}
          </div>
          <Choice<"1" | "2" | "3">
            label={t("play.test.level")}
            value={String(level) as "1" | "2" | "3"}
            onChange={(v) => setLevel(Number(v) as EmotionLevel)}
            options={(["1", "2", "3"] as const).map((v) => ({ value: v, label: t(`play.test.levels.${v}`) }))}
          />
          <Toggle label={t("play.test.react")} description={t("play.test.reactDesc")} checked={react} onChange={setReact} onLabel={t("settings.on")} offLabel={t("settings.off")} />
        </section>

        {message && (
          <p role="status" aria-live="polite" className="bg-well px-3 py-2 text-base leading-snug shadow-[inset_4px_0_0_var(--color-lavender)]" data-test-message>
            {message}
          </p>
        )}

        {/* Live status */}
        <section className="flex flex-col gap-2 border-t-[3px] border-dashed border-line pt-4">
          <p className="font-label text-xs uppercase tracking-wide text-label">
            {t("play.test.status")}
            {snap.paused && <span className="ml-2 bg-pink-hi px-1 text-rose">{t("play.test.paused")}</span>}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-base">
              <thead>
                <tr className="font-label text-[10px] uppercase text-ink-mute">
                  <th className="py-1 pr-2 font-normal">{t("play.test.colName")}</th>
                  <th className="py-1 pr-2 font-normal">{t("play.test.colState")}</th>
                  <th className="py-1 pr-2 font-normal">{t("play.test.colFeeling")}</th>
                  {!compact && <th className="py-1 font-normal">{t("play.test.colSpot")}</th>}
                </tr>
              </thead>
              <tbody>
                {snap.actors.map((a) => (
                  <tr key={a.id} className={a.id === actor?.id ? "bg-butter-hi" : undefined} data-status-row={a.id}>
                    <td className="max-w-[8rem] truncate py-1 pr-2 font-head font-bold">{nameOf(a.id)}</td>
                    <td className="py-1 pr-2">
                      {tx(`stageStates.${a.state}`)}
                      {a.suspended && <span className="ml-1 text-sm text-ink-mute">({t("play.test.suspended")})</span>}
                    </td>
                    <td className="py-1 pr-2">
                      {tx(`emotions.${a.emotion}`)}
                      {a.emotion !== "neutral" && <span className="ml-1 text-sm text-ink-mute">{"★".repeat(a.level)}</span>}
                    </td>
                    {!compact && (
                      <td className="py-1 tabular-nums text-ink-soft">
                        {a.x}, {a.y}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Panel>
  );
}
