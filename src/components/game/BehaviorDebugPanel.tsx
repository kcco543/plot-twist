"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { PixelButton } from "@/components/ui/PixelButton";
import { BEHAVIOR_ACTIONS, PERSONALITY_KEYS, SCENARIOS, TRIGGERS, type BehaviorEvent, type Decision, type Rng, type TriggerId } from "@/lib/mind";
import { rngFrom } from "@/lib/stage/behavior";
import { FEELINGS, type Character, type StoryState } from "@/lib/types";
import { useI18n } from "@/i18n";

type Props = {
  cast: Character[];
  story: StoryState;
  selectedId: string | null;
  /** Latest decisions (newest first), from gameplay and from this panel. */
  decisions: Decision[];
  sandboxKey: string | null;
  compact?: boolean;
  /** Decide + apply + play it on the stage. */
  onRun: (event: BehaviorEvent, rng?: Rng) => Decision | null;
  /** Decide only (nothing changes). */
  onPreview: (event: BehaviorEvent, rng: Rng) => Decision | null;
  onLoadScenario: (key: string) => { reactorId: string; otherId: string; trigger: TriggerId } | undefined;
  onExitScenario: () => void;
  onPassTime: () => void;
  onClose: () => void;
};

const REL_KEYS = ["trust", "affection", "respect", "familiarity", "rivalry", "tension", "fear"] as const;
const PREVIEW_RUNS = 100;

/**
 * BEHAVIOR DEBUG PANEL (developers only; Settings, shown in dev builds or after ?dev=1).
 * Shows everything the engine considered for one decision, lets you fire the
 * same event again and again (optionally with a fixed seed so a result can
 * be reproduced), and previews the odds over 100 runs without changing anything.
 */
export function BehaviorDebugPanel(props: Props) {
  const { cast, selectedId, decisions, sandboxKey, compact } = props;
  const { t, tx } = useI18n();
  const nameOf = (id: string | null | undefined) => {
    const c = cast.find((x) => x.id === id);
    return c ? c.name.trim() || t("common.unnamed") : "—";
  };
  const [reactorPick, setReactor] = useState<string>("");
  const [otherPick, setOther] = useState<string>("");
  const [trigger, setTrigger] = useState<TriggerId>("approached");
  const [seed, setSeed] = useState("");
  const [runNo, setRunNo] = useState(0);
  const [shownIdx, setShownIdx] = useState(0);
  const [preview, setPreview] = useState<{ counts: Record<string, number>; runs: number } | null>(null);

  const reactorId = cast.some((c) => c.id === reactorPick) ? reactorPick : (selectedId ?? cast[0]?.id ?? "");
  const others = cast.filter((c) => c.id !== reactorId);
  const otherId = others.some((c) => c.id === otherPick) ? otherPick : (others[0]?.id ?? "");
  const event: BehaviorEvent = { trigger, reactorId, otherId: otherId || null };
  const d = decisions[Math.min(shownIdx, decisions.length - 1)] ?? null;

  // A fixed seed reproduces a result: the same seed + the same state = the same choice.
  const rngFor = (i: number) => (seed.trim() ? rngFrom(`${seed.trim()}#${i}`) : undefined);

  const run = () => {
    if (!reactorId) return;
    props.onRun(event, rngFor(0));
    setRunNo((n) => n + 1);
    setShownIdx(0);
    setPreview(null);
  };
  const runPreview = () => {
    if (!reactorId) return;
    const counts: Record<string, number> = {};
    const base = seed.trim() || `preview-${Date.now()}`;
    for (let i = 0; i < PREVIEW_RUNS; i++) {
      const r = props.onPreview(event, rngFrom(`${base}#${i}`));
      if (r) counts[r.action] = (counts[r.action] ?? 0) + 1;
    }
    setPreview({ counts, runs: PREVIEW_RUNS });
  };
  const load = (key: string) => {
    if (!key) return props.onExitScenario();
    const r = props.onLoadScenario(key);
    if (r) {
      setReactor(r.reactorId);
      setOther(r.otherId);
      setTrigger(r.trigger);
    }
    setPreview(null);
    setShownIdx(0);
  };

  const sel = "px-input mt-1 min-h-11 w-full bg-white px-2 text-base";
  const lbl = "font-label text-xs uppercase tracking-wide text-label";
  const section = "flex flex-col gap-2 border-t-[3px] border-dashed border-line pt-3";
  const actionName = (a: string) => tx(`behave.actions.${a}`);

  return (
    <Panel className="w-full" aria-label={t("debug.title")}>
      <div data-behavior-debug />
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-head text-xl font-bold">{t("debug.title")}</h2>
            <p className="mt-1 text-base leading-snug text-ink-soft">{t("debug.intro")}</p>
          </div>
          <PixelButton size="sm" variant="ghost" icon="close" onClick={props.onClose} aria-label={t("debug.close")} />
        </div>

        {/* Scenario */}
        <label className="flex flex-col">
          <span className={lbl}>{t("debug.scenario")}</span>
          <select className={sel} value={sandboxKey ?? ""} onChange={(e) => load(e.target.value)} data-debug-scenario>
            <option value="">{t("debug.liveCast")}</option>
            {SCENARIOS.map((s, i) => (
              <option key={s.key} value={s.key}>
                {i + 1}. {tx(`debug.scenarios.${s.key}`)}
              </option>
            ))}
          </select>
        </label>
        {sandboxKey && <p className="bg-butter-hi px-3 py-2 text-base leading-snug shadow-[inset_4px_0_0_var(--color-butter-lo)]">{t("debug.sandboxNotice")}</p>}

        {/* Event */}
        <div className={`grid gap-3 ${compact ? "" : "sm:grid-cols-3"}`}>
          <label className="flex flex-col">
            <span className={lbl}>{t("debug.reactor")}</span>
            <select className={sel} value={reactorId} onChange={(e) => setReactor(e.target.value)}>
              {cast.map((c) => (
                <option key={c.id} value={c.id}>
                  {nameOf(c.id)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            <span className={lbl}>{t("debug.trigger")}</span>
            <select className={sel} value={trigger} onChange={(e) => setTrigger(e.target.value as TriggerId)} data-debug-trigger>
              {TRIGGERS.map((tr) => (
                <option key={tr} value={tr}>
                  {tx(`debug.triggers.${tr}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            <span className={lbl}>{t("debug.by")}</span>
            <select className={sel} value={otherId} onChange={(e) => setOther(e.target.value)} disabled={others.length === 0}>
              {others.length === 0 && <option value="">{t("play.test.nobody")}</option>}
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {nameOf(c.id)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col">
          <span className={lbl}>{t("debug.seed")}</span>
          <input className={sel} value={seed} onChange={(e) => setSeed(e.target.value)} placeholder={t("debug.seedPlaceholder")} data-debug-seed />
        </label>
        <div className="flex flex-wrap gap-2">
          <PixelButton size="sm" variant="primary" icon="play" disabled={!reactorId} onClick={run} data-debug-run>
            {t("debug.run")}
          </PixelButton>
          <PixelButton size="sm" variant="magic" disabled={!reactorId} onClick={runPreview} data-debug-preview>
            {t("debug.preview", { n: PREVIEW_RUNS })}
          </PixelButton>
          <PixelButton size="sm" variant="ghost" onClick={props.onPassTime}>
            {t("debug.passTime")}
          </PixelButton>
          {sandboxKey && (
            <PixelButton size="sm" variant="accent" onClick={() => load(sandboxKey)}>
              {t("debug.resetScenario")}
            </PixelButton>
          )}
        </div>
        {runNo > 0 && seed.trim() && <p className="text-sm text-ink-mute">{t("debug.seedNote")}</p>}

        {preview && (
          <section className={section} data-debug-distribution>
            <p className={lbl}>{t("debug.distribution", { n: preview.runs })}</p>
            {Object.entries(preview.counts)
              .sort((a, b) => b[1] - a[1])
              .map(([a, n]) => (
                <Bar key={a} label={actionName(a)} value={n / preview.runs} text={`${n}%`} />
              ))}
          </section>
        )}

        {/* Decision log */}
        {decisions.length > 0 && (
          <section className={section}>
            <p className={lbl}>{t("debug.log")}</p>
            <ol className="flex flex-col gap-1">
              {decisions.map((x, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => setShownIdx(i)}
                    className={`w-full px-2 py-1 text-left text-base leading-snug ${i === shownIdx ? "bg-butter-hi" : "bg-well"}`}
                  >
                    <b>{nameOf(x.event.reactorId)}</b> {tx(`debug.triggers.${x.event.trigger}`)} {nameOf(x.event.otherId)} → <b>{actionName(x.action)}</b>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}

        {d ? <DecisionView d={d} nameOf={nameOf} compact={!!compact} /> : <p className="text-base text-ink-soft">{t("debug.empty")}</p>}
      </div>
    </Panel>
  );
}

function Bar({ label, value, text, signed = false, tone = "bg-mint-lo" }: { label: string; value: number; text: string; signed?: boolean; tone?: string }) {
  const pct = Math.min(100, Math.abs(value) * (signed ? 50 : 100));
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 truncate text-sm leading-tight" title={label}>
        {label}
      </span>
      <span className="relative h-2.5 flex-1 bg-well">
        {signed && <span className="absolute inset-y-0 left-1/2 w-px bg-line" />}
        <span
          className={`absolute inset-y-0 ${signed ? (value >= 0 ? "left-1/2" : "right-1/2") : "left-0"} ${signed && value < 0 ? "bg-coral" : tone}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-12 shrink-0 text-right font-label text-[10px] tabular-nums text-ink-soft">{text}</span>
    </div>
  );
}

function DecisionView({ d, nameOf, compact }: { d: Decision; nameOf: (id: string | null) => string; compact: boolean }) {
  const { t, tx } = useI18n();
  const lbl = "font-label text-xs uppercase tracking-wide text-label";
  const section = "flex flex-col gap-2 border-t-[3px] border-dashed border-line pt-3";
  const actionName = (a: string) => tx(`behave.actions.${a}`);
  const me = nameOf(d.event.reactorId);
  const other = nameOf(d.event.otherId);
  const traits = useMemo(() => PERSONALITY_KEYS.filter((k) => !["intro", "cautious", "reserved", "distrustful", "pragmatic", "independent", "avoidant", "serious"].includes(k)), []);
  const best = d.candidates[0]?.score ?? 0;

  return (
    <div className="flex flex-col gap-3" data-debug-decision>
      <section className="bg-butter-hi px-3 py-2 shadow-[inset_4px_0_0_var(--color-butter-lo)]">
        <p className={lbl}>{t("debug.selected")}</p>
        <p className="font-head text-lg font-bold" data-debug-selected={d.action}>
          {me} → {actionName(d.action)}
        </p>
        <p className="text-base leading-snug">
          {t("debug.because")}{" "}
          {d.reasons.length ? d.reasons.map((r) => `${r.key} (+${r.value.toFixed(2)})`).join(", ") : t("debug.noStrongReason")}
        </p>
        <p className="mt-1 text-sm leading-snug text-ink-soft">
          {t("debug.chance", { p: Math.round((d.candidates.find((c) => c.action === d.action)?.prob ?? 0) * 100), temp: d.temperature.toFixed(2) })}
          {" · "}
          {d.expression ? t("debug.shows", { emotion: tx(`emotions.${d.expression.emotion}`), level: ["", t("debug.subtle"), t("debug.moderate"), t("debug.strong")][d.expression.level] }) : t("debug.showsNothing")}
          {d.expression?.masked ? ` (${t("debug.masked")})` : ""}
          {" · "}
          {t("debug.pause", { ms: d.pauseMs })}
        </p>
        <p className="mt-1 text-sm leading-snug text-ink-soft">
          {t("debug.style")}: {d.style.length}, {d.style.tone}, {t("debug.directness")} {d.style.directness}, {t("debug.humor")} {d.style.humor}, {t("debug.formality")} {d.style.formality}, {t("debug.disclosure")} {d.style.disclosure}
          {d.style.hesitant ? `, ${t("debug.hesitant")}` : ""}
        </p>
        <p className="mt-1 text-sm leading-snug text-ink-soft">
          {t("debug.movement")}: {d.movement.length ? d.movement.map((m) => `${m.action.type}${m.delay ? ` +${m.delay}ms` : ""}`).join(" → ") : "—"}
        </p>
      </section>

      <section className={section}>
        <p className={lbl}>{t("debug.candidates")}</p>
        <div className="flex flex-col gap-1.5">
          {d.candidates.map((c) => (
            <div key={c.action} className={c.action === d.action ? "bg-butter-hi px-1" : "px-1"}>
              <Bar label={actionName(c.action)} value={c.prob} text={`${Math.round(c.prob * 100)}%`} tone={c.action === d.action ? "bg-rose" : "bg-mint-lo"} />
              <p className="pl-1 text-xs leading-snug text-ink-mute">
                {t("debug.score")} {c.score.toFixed(2)} ({(c.score - best).toFixed(2)})
                {c.penalty < 1 ? ` · ${t("debug.repeatPenalty", { x: c.penalty.toFixed(2) })}` : ""}
                {c.terms.length ? ` · ${c.terms.slice(0, 3).map((x) => `${x.key} ${x.value >= 0 ? "+" : ""}${x.value.toFixed(2)}`).join(", ")}` : ""}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className={section}>
        <p className={lbl}>{t("debug.rejected")}</p>
        {d.rejected.length ? (
          <ul className="flex flex-col gap-1 text-base">
            {d.rejected.map((r) => (
              <li key={r.action} data-debug-rejected={r.action}>
                <b>{actionName(r.action)}</b>: {tx(`debug.reasons.${r.reason}`, { detail: r.detail ?? "" })}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-base text-ink-soft">{t("debug.noneRejected")}</p>
        )}
        {d.canonRules.length > 0 && <p className="text-sm text-ink-soft">{t("debug.canonRules", { rules: d.canonRules.join(", ") })}</p>}
        <p className="text-xs text-ink-mute">{t("debug.notApplicable", { n: BEHAVIOR_ACTIONS.length - d.candidates.length - d.rejected.length })}</p>
      </section>

      <section className={section}>
        <p className={lbl}>{t("debug.feelings", { name: me })}</p>
        {FEELINGS.filter((k) => (d.feelings[k] ?? 0) > 0 || (d.feelingsBefore[k] ?? 0) > 0).map((k) => (
          <Bar key={k} label={tx(`debug.feelingNames.${k}`)} value={(d.feelings[k] ?? 0) / 100} text={`${d.feelingsBefore[k] ?? 0}→${d.feelings[k] ?? 0}`} tone="bg-pink" />
        ))}
        {!FEELINGS.some((k) => (d.feelings[k] ?? 0) > 0) && <p className="text-base text-ink-soft">{t("debug.calm")}</p>}
      </section>

      {d.relation && (
        <section className={section}>
          <p className={lbl}>{t("debug.relation")}</p>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="font-label text-[10px] uppercase text-ink-mute">
                <th className="py-1 pr-2 font-normal" />
                <th className="py-1 pr-2 font-normal">
                  {me} → {other}
                </th>
                <th className="py-1 font-normal">
                  {other} → {me}
                </th>
              </tr>
            </thead>
            <tbody>
              {REL_KEYS.map((k) => (
                <tr key={k}>
                  <td className="py-0.5 pr-2">{tx(`debug.rel.${k}`)}</td>
                  <td className="py-0.5 pr-2 tabular-nums">{d.relation![k]}</td>
                  <td className="py-0.5 tabular-nums">{d.relationBack?.[k] ?? "—"}</td>
                </tr>
              ))}
              <tr>
                <td className="py-0.5 pr-2">{t("debug.rel.label")}</td>
                <td className="py-0.5 pr-2">{d.relation.label ? tx(`debug.labels.${d.relation.label}`) : "—"}</td>
                <td className="py-0.5">{d.relationBack?.label ? tx(`debug.labels.${d.relationBack.label}`) : "—"}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-ink-mute">{t("debug.labelNote")}</p>
        </section>
      )}

      <section className={section}>
        <p className={lbl}>{t("debug.memories")}</p>
        {d.memories.length ? (
          <ul className="flex flex-col gap-1 text-base">
            {d.memories.map((m, i) => (
              <li key={i}>
                {tx(`debug.memoryKinds.${m.kind}`)} · {"★".repeat(m.importance)}
                {m.count > 1 ? ` ×${m.count}` : ""} <span className="text-sm text-ink-mute">({t("debug.turn", { n: m.turn })})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-base text-ink-soft">{t("debug.noMemories")}</p>
        )}
      </section>

      <section className={section}>
        <p className={lbl}>{t("debug.personality")}</p>
        <div className={`grid gap-x-4 gap-y-1 ${compact ? "" : "sm:grid-cols-2"}`}>
          {traits.map((k) => (
            <Bar key={k} label={`p.${k}`} value={d.personality[k]} text={d.personality[k].toFixed(2)} tone="bg-lavender" />
          ))}
        </div>
        <p className="text-xs text-ink-mute">{t("debug.legend")}</p>
      </section>
    </div>
  );
}
