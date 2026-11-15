"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { PixelButton } from "@/components/ui/PixelButton";
import { useI18n } from "@/i18n";
import { relevantMemories } from "@/lib/mind/memory";
import { currentRelation, progressOf } from "@/lib/relationships/progression";
import { ordinarySimulation, runScenarios, type ScenarioResult } from "@/lib/relationships/scenarios";
import { bondLabel, ladder, stageIndex } from "@/lib/relationships/stages";
import { impressionViews } from "@/lib/relationships/summary";
import { AXES, NUM_KEYS, type ChangeRecord, type Delta } from "@/lib/relationships/types";
import { PLAYER_ID, type Character, type StoryState } from "@/lib/types";

type Props = { cast: Character[]; story: StoryState; selectedId: string | null; compact?: boolean; onClose: () => void };

const fmtDelta = (d: Delta) =>
  NUM_KEYS.filter((k) => d[k])
    .map((k) => `${k} ${d[k]! > 0 ? "+" : ""}${d[k]}`)
    .join(", ") || "—";
const fmtFeel = (f: Record<string, number>) =>
  Object.entries(f)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ") || "—";

/**
 * RELATIONSHIP INSPECTOR (developers only; Settings, shown in dev builds or after ?dev=1).
 * For one direction (how A sees B): the long-term numbers and their stages,
 * what's needed for the next stage, impressions, milestones, open conflicts,
 * promises, refused requests, relevant memories and every validated change
 * with the reasons a proposal was accepted, reduced or refused. The scenario
 * runner replays the relationship test scenarios with a fixed seed.
 */
export function RelationshipInspector({ cast, story, selectedId, compact, onClose }: Props) {
  const { t, tx } = useI18n();
  const [fromPick, setFrom] = useState("");
  const [toPick, setTo] = useState("");
  const [seed, setSeed] = useState("42");
  const [results, setResults] = useState<ScenarioResult[] | null>(null);
  const [sim, setSim] = useState<ReturnType<typeof ordinarySimulation> | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const from = cast.find((c) => c.id === fromPick) ?? cast.find((c) => c.id === selectedId) ?? cast[0] ?? null;
  const targets = cast.filter((c) => c.id !== from?.id);
  const toId = toPick === PLAYER_ID || targets.some((c) => c.id === toPick) ? toPick : (targets[0]?.id ?? PLAYER_ID);
  const to = toId === PLAYER_ID ? null : (cast.find((c) => c.id === toId) ?? null);
  const nameOf = (c: Character | null) => (c ? c.name.trim() || t("common.unnamed") : t("relInspector.visitor"));

  const view = useMemo(() => {
    if (!from) return null;
    const p = progressOf(story, from, to);
    const rel = currentRelation(story, from, to);
    return { p, rel, label: bondLabel(rel, p.stages), memories: relevantMemories(story.characters[from.id], to?.id ?? PLAYER_ID, 4) };
  }, [story, from, to]);

  const seedNum = Number.parseInt(seed, 10) || 42;

  return (
    <Panel title={t("relInspector.title")} className={compact ? "" : "w-full"} titleRight={<PixelButton size="sm" variant="ghost" icon="close" onClick={onClose} aria-label={t("relInspector.close")} />}>
      <div className="flex flex-col gap-4 text-sm" data-relationship-inspector>
        <p className="text-ink-soft">{t("relInspector.intro")}</p>
        {from && view ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 font-label text-[10px] uppercase text-label">
                {t("relInspector.from")}
                <select className="px-input min-h-9 py-1 text-sm normal-case" value={from.id} onChange={(e) => setFrom(e.target.value)} data-inspector-from>
                  {cast.map((c) => (
                    <option key={c.id} value={c.id}>
                      {nameOf(c)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 font-label text-[10px] uppercase text-label">
                {t("relInspector.toward")}
                <select className="px-input min-h-9 py-1 text-sm normal-case" value={toId} onChange={(e) => setTo(e.target.value)} data-inspector-to>
                  {targets.map((c) => (
                    <option key={c.id} value={c.id}>
                      {nameOf(c)}
                    </option>
                  ))}
                  <option value={PLAYER_ID}>{t("relInspector.visitor")}</option>
                </select>
              </label>
            </div>

            <section>
              <h3 className="mb-1 font-label text-[10px] uppercase text-rose">
                {t("relInspector.longTerm")} · {tx(`rel.label.${view.label}`)}
                {view.p.grandfathered && view.p.log.length === 0 ? ` · ${t("relInspector.grandfathered")}` : ""}
              </h3>
              <table className="w-full text-left tabular-nums">
                <tbody>
                  {AXES.map((axis) => {
                    const l = ladder(axis);
                    const i = stageIndex(axis, view.p.stages[axis]);
                    const next = l[i + 1];
                    const pend = view.p.log.at(-1)?.pending.find((x) => x.axis === axis);
                    return (
                      <tr key={axis} className="border-b border-line/60 align-top">
                        <td className="py-0.5 pr-2">{axis}</td>
                        <td className="py-0.5 pr-2 font-bold">{(view.rel[axis] as number | undefined) ?? 0}</td>
                        <td className="py-0.5 pr-2">{tx(`rel.stage.${axis}.${l[i].id}`)}</td>
                        <td className="py-0.5 text-ink-mute">
                          {next ? `${t("relInspector.next", { stage: tx(`rel.stage.${axis}.${next.id}`), at: next.enter, exit: l[i].exit === -Infinity ? "—" : l[i].exit })}` : t("relInspector.top")}
                          {pend ? ` · ${t("relInspector.needs")} ${pend.needs.join(", ")}` : ""}
                        </td>
                      </tr>
                    );
                  })}
                  {(["rivalry", "fear", "dependence"] as const).map((k) => (
                    <tr key={k} className="border-b border-line/60">
                      <td className="py-0.5 pr-2">{k}</td>
                      <td className="py-0.5 pr-2 font-bold">{(view.rel[k] as number | undefined) ?? 0}</td>
                      <td colSpan={2} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section>
              <h3 className="mb-1 font-label text-[10px] uppercase text-rose">{t("relInspector.impressions")}</h3>
              {impressionViews(view.p).length === 0 ? (
                <p className="text-ink-mute">{t("relInspector.none")}</p>
              ) : (
                <ul className="flex flex-col gap-0.5" data-inspector-impressions>
                  {impressionViews(view.p).map((i) => (
                    <li key={i.theme}>
                      {t(`rel.impression.prefix.${i.strength}`, { name: nameOf(from) })} {tx(`rel.impression.${i.theme}.${i.polarity}`, { other: nameOf(to) })}{" "}
                      <span className="text-ink-mute">
                        ({i.score.toFixed(2)}, {t("relInspector.evidence", { n: i.evidence })})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <div>
                <h3 className="mb-1 font-label text-[10px] uppercase text-rose">{t("relInspector.milestones")}</h3>
                {view.p.milestones.length === 0 ? (
                  <p className="text-ink-mute">{t("relInspector.none")}</p>
                ) : (
                  <ul className="flex flex-col gap-0.5" data-inspector-milestones>
                    {[...view.p.milestones].reverse().slice(0, 8).map((m) => (
                      <li key={m.id} className={m.positive ? "" : "text-coral-deep"}>
                        {t("relInspector.turn", { n: m.turn })} · {tx(`rel.milestone.${m.kind}`)}
                        {m.why ? <span className="text-ink-mute"> — {m.why}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="mb-1 font-label text-[10px] uppercase text-rose">{t("relInspector.openThings")}</h3>
                <ul className="flex flex-col gap-0.5">
                  {view.p.conflicts.filter((c) => !c.resolved).map((c) => (
                    <li key={c.id}>{t("relInspector.conflict", { kind: c.kind, turn: c.turn, apologies: c.apologies, repair: c.repair, need: c.repairNeeded })}</li>
                  ))}
                  {view.p.promises.map((p) => (
                    <li key={p.id}>{t("relInspector.promise", { status: p.status, text: p.text || "—", turn: p.turn })}</li>
                  ))}
                  {Object.entries(view.p.pressure).map(([topic, pr]) => (
                    <li key={topic} data-inspector-pressure={topic}>
                      {t("relInspector.pressure", { topic, asks: pr.asks, refusals: pr.refusals, last: pr.lastIntention ?? "—" })}
                    </li>
                  ))}
                  {view.p.openedSoft.map((id) => (
                    <li key={id}>{t("relInspector.opened", { id })}</li>
                  ))}
                  {view.p.conflicts.every((c) => c.resolved) && view.p.promises.length === 0 && Object.keys(view.p.pressure).length === 0 && <li className="text-ink-mute">{t("relInspector.none")}</li>}
                </ul>
              </div>
            </section>

            <section>
              <h3 className="mb-1 font-label text-[10px] uppercase text-rose">{t("relInspector.memories")}</h3>
              {view.memories.length === 0 ? <p className="text-ink-mute">{t("relInspector.none")}</p> : <ul>{view.memories.map((m) => <li key={m.id}>· {m.note ?? m.kind ?? m.eventType} <span className="text-ink-mute">({t("relInspector.importance", { n: m.importance })})</span></li>)}</ul>}
            </section>

            <section>
              <h3 className="mb-1 font-label text-[10px] uppercase text-rose">{t("relInspector.log")}</h3>
              {view.p.log.length === 0 ? (
                <p className="text-ink-mute">{t("relInspector.noLog")}</p>
              ) : (
                <ol className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1" data-inspector-log>
                  {[...view.p.log].reverse().map((c: ChangeRecord) => (
                    <li key={c.id} className="border-l-4 border-lavender-lo bg-well/60 px-2 py-1">
                      <button className="w-full text-left" onClick={() => setOpen(open === c.id ? null : c.id)}>
                        <span className="font-bold">
                          {t("relInspector.turn", { n: c.turn })} · {c.kind}
                          {c.proposedKind !== c.kind ? ` (${t("relInspector.proposedAs", { kind: c.proposedKind })})` : ""}
                        </span>{" "}
                        <span className="text-ink-mute">
                          {c.source} · {c.significance.proposed}
                          {c.significance.accepted !== c.significance.proposed ? ` → ${c.significance.accepted}` : ""}
                        </span>
                        <span className="block">{t("relInspector.accepted")}: {fmtDelta(c.accepted)}</span>
                      </button>
                      {open === c.id && (
                        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
                          <dt className="text-ink-mute">{t("relInspector.proposed")}</dt>
                          <dd>{fmtDelta(c.proposed)}</dd>
                          <dt className="text-ink-mute">{t("relInspector.before")}</dt>
                          <dd>{fmtDelta(c.before)}</dd>
                          <dt className="text-ink-mute">{t("relInspector.after")}</dt>
                          <dd>{fmtDelta(c.after)}</dd>
                          <dt className="text-ink-mute">{t("relInspector.feelings")}</dt>
                          <dd>
                            {fmtFeel(c.feelings.before)} → {fmtFeel(c.feelings.after)}
                          </dd>
                          <dt className="text-ink-mute">{t("relInspector.reasons")}</dt>
                          <dd>{c.reasons.length ? c.reasons.join(" · ") : t("relInspector.noReasons")}</dd>
                          <dt className="text-ink-mute">{t("relInspector.milestones")}</dt>
                          <dd>{c.milestones.join(", ") || "—"}</dd>
                          <dt className="text-ink-mute">{t("relInspector.stages")}</dt>
                          <dd>
                            {c.stageChanges.map((s) => `${s.axis}: ${s.from} → ${s.to}`).join("; ") || t("relInspector.noStageChange")}
                            {c.pending.length ? ` · ${c.pending.map((p) => `${p.axis} → ${p.next}: ${p.needs.join(", ")}`).join("; ")}` : ""}
                          </dd>
                          <dt className="text-ink-mute">{t("relInspector.memories")}</dt>
                          <dd>{c.memories.join(" · ") || "—"}</dd>
                          {c.why ? (
                            <>
                              <dt className="text-ink-mute">{t("relInspector.why")}</dt>
                              <dd>{c.why}</dd>
                            </>
                          ) : null}
                        </dl>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        ) : (
          <p className="text-ink-mute">{t("relInspector.noCast")}</p>
        )}

        <section className="flex flex-col gap-2 border-t-2 border-dashed border-line pt-3">
          <h3 className="font-label text-[10px] uppercase text-rose">{t("relInspector.tests")}</h3>
          <p className="text-ink-soft">{t("relInspector.testsIntro")}</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 font-label text-[10px] uppercase text-label">
              {t("relInspector.seed")}
              <input className="px-input min-h-9 w-24 py-1 text-sm" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, "").slice(0, 9))} data-inspector-seed />
            </label>
            <PixelButton size="sm" variant="calm" icon="dice" onClick={() => setResults(runScenarios(seedNum))} data-run-scenarios>
              {t("relInspector.runScenarios")}
            </PixelButton>
            <PixelButton size="sm" variant="ghost" icon="play" onClick={() => setSim(ordinarySimulation(seedNum, 20))} data-run-simulation>
              {t("relInspector.runSimulation")}
            </PixelButton>
          </div>
          {results && (
            <ul className="flex flex-col gap-1" data-scenario-results>
              <li className="font-bold">{t("relInspector.passed", { n: results.filter((r) => r.pass).length, total: results.length })}</li>
              {results.map((r) => (
                <li key={r.id} className={r.pass ? "" : "text-coral-deep"}>
                  {r.pass ? "✓" : "✗"} {r.title}
                  <span className="block pl-4 text-xs text-ink-mute">{r.details.join(" — ")}</span>
                </li>
              ))}
            </ul>
          )}
          {sim && (
            <div className="overflow-x-auto" data-simulation>
              <p>
                {t("relInspector.simSummary", { start: fmtDelta(sim.start), end: fmtDelta(sim.end), from: sim.label.start, to: sim.label.end })}
              </p>
              <table className="min-w-[36rem] text-left text-xs tabular-nums">
                <thead>
                  <tr className="text-ink-mute">
                    <th className="pr-2">#</th>
                    <th className="pr-2">{t("relInspector.proposed")}</th>
                    <th className="pr-2">{t("relInspector.accepted")}</th>
                    <th className="pr-2">{t("relInspector.after")}</th>
                    <th>{t("relInspector.stages")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sim.rows.map((r) => (
                    <tr key={r.n} className="border-b border-line/60 align-top">
                      <td className="pr-2">{r.n}</td>
                      <td className="pr-2">
                        {r.aiProposed.kind}/{r.aiProposed.significance}: {fmtDelta(r.aiProposed.changes)}
                      </td>
                      <td className="pr-2">
                        {r.validated.kind}/{r.validated.significance}: {fmtDelta(r.validated.changes)}
                      </td>
                      <td className="pr-2">{fmtDelta(r.after)}</td>
                      <td>{[...r.stageChanges, ...r.pending].join("; ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Panel>
  );
}
