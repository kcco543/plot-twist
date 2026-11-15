"use client";

import { useState } from "react";
import { Field } from "@/components/ui/Field";
import { LoadingDots } from "@/components/ui/LoadingDots";
import { Panel } from "@/components/ui/Panel";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { AiRequestError, briefFor, requestRefine, useAiStatus } from "@/lib/ai/client";
import { acceptBlockers, acceptProposal, lastAccepted, rejectProposal, restoreRevision, versionOf, withProposal } from "@/lib/behavior/refine";
import { getSave } from "@/lib/gameStore";
import { makeId } from "@/lib/id";
import type { BehaviorRecord, Character, CharacterTextField } from "@/lib/types";
import { useI18n } from "@/i18n";
import { ProfileView } from "./AnalysisPanel";

/**
 * "Refine This Analysis": the player's feedback → an AI-proposed revision →
 * Accept / Reject. Locked canon wins: a conflict has to be resolved before
 * Accept, and an ambiguous reading has to be confirmed. History keeps every
 * revision so any earlier version can be restored. Only this world's version
 * of the character is changed.
 */
export function RefinePanel({ character, record, onChange, onEditField }: { character: Character; record: BehaviorRecord; onChange: (patch: Partial<Character>) => void; onEditField?: (f: CharacterTextField) => void }) {
  const { t, tx, locale } = useI18n();
  const status = useAiStatus();
  const [feedback, setFeedback] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const proposal = record.proposal ?? null;
  const mode: "ai" | "mock" | null = status?.text ? "ai" : status?.talk === "mock" ? "mock" : null;
  const setRecord = (r: BehaviorRecord) => onChange({ behavior: r });

  const send = async (text: string, keepCanon: boolean) => {
    setRunning(true);
    setError(null);
    setConfirmed(false);
    try {
      const save = getSave();
      const out = await requestRefine({
        locale,
        world: save.worldId,
        character: briefFor({ ...character, behavior: null }),
        profile: record.profile,
        feedback: text,
        keepCanon,
        earlier: (record.revisions ?? []).filter((r) => r.kind === "feedback").slice(-6).map((r) => ({ feedback: r.feedback.slice(0, 1500), status: r.status })),
      });
      setRecord(withProposal(record, { ...out, id: makeId("rev"), at: Date.now(), feedback: text, sourceVersion: versionOf(record), keepCanon }));
    } catch (e) {
      setError(tx(`ai.errors.${e instanceof AiRequestError ? e.code : "failed"}`));
    } finally {
      setRunning(false);
    }
  };

  const blockers = proposal ? acceptBlockers(record, proposal, confirmed) : [];
  const undoable = lastAccepted(record);
  const history = [...(record.revisions ?? [])].reverse();
  const fmt = (at: number) => new Date(at).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <Panel title={t("refine.title")}>
      <div className="flex flex-col gap-4" data-refine-panel>
        <p className="max-w-2xl text-base leading-snug text-ink-soft">{t("refine.intro")}</p>
        <p className="bg-well px-3 py-2 text-base leading-snug">
          <span className="mr-2 font-label text-[10px] uppercase text-label">{t("refine.current", { n: versionOf(record) })}</span>
          {record.profile.summary}
        </p>

        <Field label={t("refine.label")} multiline rows={4} maxLength={1500} value={feedback} onChange={setFeedback} placeholder={t("refine.placeholder")} hint={t("refine.hint")} />
        <div className="flex flex-wrap items-center gap-3">
          <PixelButton variant="magic" icon="sparkle" loading={running} disabled={!feedback.trim() || !mode || running} onClick={() => void send(feedback.trim(), false)}>
            {running ? t("refine.applying") : t("refine.apply")}
          </PixelButton>
          {mode === "mock" && <span className="bg-butter-hi px-1.5 font-label text-[10px] uppercase text-ink">{t("refine.testMode")}</span>}
          {undoable && !proposal && (
            <PixelButton size="sm" variant="ghost" icon="undo" onClick={() => setRecord(restoreRevision(record, undoable.id, "previous", makeId("rev")))}>
              {t("refine.restorePrevious")}
            </PixelButton>
          )}
        </div>
        {status && !mode && <p className="text-sm text-ink-soft">{t("refine.unavailable")}</p>}
        {running && (
          <p role="status" className="flex items-center gap-2 font-label text-xs uppercase text-ink-soft">
            {t("refine.applying")} <LoadingDots className="text-label" />
          </p>
        )}
        {error && (
          <p role="alert" className="bg-peach-hi px-3 py-2 text-base shadow-[inset_4px_0_0_var(--color-peach-lo)]">
            {t("ai.errorTitle", { reason: error })}
          </p>
        )}

        {proposal && (
          <section className="flex flex-col gap-4 bg-lavender-hi/50 p-3 shadow-[inset_4px_0_0_var(--color-lavender)]" data-proposal>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-label text-xs uppercase tracking-wide text-label">{t("refine.proposalTitle")}</h3>
              {proposal.source === "mock" && <span className="bg-butter-hi px-1.5 font-label text-[10px] uppercase">TEST</span>}
            </div>
            <p className="text-base leading-snug">
              <span className="font-bold">{t("refine.yourFeedback")}</span> “{proposal.feedback}”
            </p>
            <p className="text-base leading-snug">
              <span className="font-bold">{t("refine.understood")}</span> {proposal.interpretation}
            </p>

            {proposal.canonConflicts.length > 0 && !proposal.keepCanon && (
              <div role="alert" className="flex flex-col gap-2 bg-peach-hi px-3 py-2 shadow-[inset_4px_0_0_var(--color-coral)]">
                <p className="flex items-center gap-2 font-bold">
                  <PixelIcon name="lock" size={12} /> {t("refine.conflictTitle")}
                </p>
                <ul className="flex flex-col gap-2 text-base leading-snug">
                  {proposal.canonConflicts.map((c, i) => (
                    <li key={i}>
                      <span className="font-label text-[10px] uppercase text-rose">{tx(`character.fields.${c.field}.label`)}</span> “{c.canon}”
                      <span className="block text-ink-soft">{c.note}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <PixelButton size="sm" variant="accent" icon="lock" loading={running} onClick={() => void send(proposal.feedback, true)}>
                    {t("refine.keepCanon")}
                  </PixelButton>
                  {onEditField && (
                    <PixelButton size="sm" variant="ghost" icon="pencil" onClick={() => onEditField(proposal.canonConflicts[0].field as CharacterTextField)}>
                      {t("refine.editCanon")}
                    </PixelButton>
                  )}
                </div>
              </div>
            )}
            {proposal.keepCanon && <p className="text-sm text-ink-soft">{t("refine.keptCanon")}</p>}

            {proposal.ambiguities.length > 0 && (
              <div className="flex flex-col gap-2 bg-butter-hi px-3 py-2 shadow-[inset_4px_0_0_var(--color-butter-lo)]">
                <p className="font-bold">{t("refine.ambiguousTitle")}</p>
                <ul className="flex flex-col gap-1 text-base leading-snug">
                  {proposal.ambiguities.map((a, i) => (
                    <li key={i}>
                      {a.question} <span className="text-ink-soft">→ {a.interpretation}</span>
                    </li>
                  ))}
                </ul>
                <label className="flex items-center gap-2 text-base">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="size-5 accent-[var(--color-label)]" />
                  {t("refine.confirmReading")}
                </label>
              </div>
            )}

            <div>
              <h4 className="mb-1.5 font-label text-[11px] uppercase text-rose">{t("refine.changes")}</h4>
              {proposal.changes.length === 0 ? (
                <p className="text-base text-ink-mute">{t("refine.noChanges")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {proposal.changes.map((c, i) => (
                    <li key={i} className="bg-white/80 px-2 py-1.5 text-base leading-snug">
                      <span className="font-label text-[10px] uppercase text-label">{tx(`refine.sections.${c.section}`)}</span>
                      <span className="block text-ink-mute line-through decoration-1">{c.before}</span>
                      <span className="block">{c.after}</span>
                      {c.why && <span className="block text-sm text-ink-soft">{t("refine.why", { why: c.why })}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {proposal.kept.length > 0 && (
              <div>
                <h4 className="mb-1.5 font-label text-[11px] uppercase text-rose">{t("refine.kept")}</h4>
                <ul className="flex flex-col gap-1 text-base leading-snug text-ink-soft">
                  {proposal.kept.map((k, i) => (
                    <li key={i}>✓ {k}</li>
                  ))}
                </ul>
              </div>
            )}
            <details>
              <summary className="cursor-pointer font-label text-xs uppercase text-label">{t("refine.preview")}</summary>
              <div className="mt-3">
                <ProfileView profile={proposal.profile} />
              </div>
            </details>

            {blockers.includes("stale") && <p className="text-sm text-coral-deep">{t("refine.stale")}</p>}
            <div className="flex flex-wrap gap-2">
              <PixelButton size="sm" variant="success" icon="check" disabled={blockers.length > 0} onClick={() => setRecord(acceptProposal(record, confirmed))}>
                {t("refine.accept")}
              </PixelButton>
              <PixelButton size="sm" variant="ghost" icon="close" onClick={() => setRecord(rejectProposal(record))}>
                {t("refine.reject")}
              </PixelButton>
            </div>
            {blockers.length > 0 && !blockers.includes("stale") && <p className="text-sm text-ink-soft">{blockers.includes("canon") ? t("refine.blockedCanon") : t("refine.blockedAmbiguous")}</p>}
          </section>
        )}

        {history.length > 0 && (
          <details data-revision-history>
            <summary className="cursor-pointer font-label text-xs uppercase text-label">{t("refine.history", { n: history.length })}</summary>
            <ol className="mt-3 flex flex-col gap-2">
              {history.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 bg-well px-2 py-1.5 text-base leading-snug">
                  <span className="min-w-0 flex-1 basis-56">
                    <span className="font-label text-[10px] uppercase text-ink-soft">
                      {fmt(r.at)} · {t(`refine.status.${r.kind === "restore" ? "restored" : r.status}`)}
                      {r.resultVersion ? ` · v${r.resultVersion}` : ""}
                    </span>
                    <span className="block">{r.kind === "restore" ? t("refine.restoreEntry", { n: r.sourceVersion }) : `“${r.feedback}”`}</span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {r.accepted && (
                      <PixelButton size="sm" variant="ghost" onClick={() => setRecord(restoreRevision(record, r.id, "accepted", makeId("rev")))}>
                        {t("refine.useThis")}
                      </PixelButton>
                    )}
                    <PixelButton size="sm" variant="ghost" icon="undo" onClick={() => setRecord(restoreRevision(record, r.id, "previous", makeId("rev")))}>
                      {t("refine.useBefore")}
                    </PixelButton>
                  </span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </Panel>
  );
}
