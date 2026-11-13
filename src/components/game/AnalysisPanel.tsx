"use client";

import { useState, type ReactNode } from "react";
import { LoadingDots } from "@/components/ui/LoadingDots";
import { Panel } from "@/components/ui/Panel";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { AiRequestError, briefFor, memoryBrief, requestAnalysis, useAiStatus } from "@/lib/ai/client";
import { buildLocalProfile } from "@/lib/behavior/localAnalysis";
import { hasPersonalityInput, profileInputHash } from "@/lib/character/model";
import { getSave } from "@/lib/gameStore";
import { REACTIONS, type BehaviorProfile, type BehaviorRecord, type Character } from "@/lib/types";
import { useI18n } from "@/i18n";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-1.5 font-label text-[11px] uppercase tracking-wide text-rose">{title}</h3>
      {children}
    </section>
  );
}

const List = ({ items }: { items: string[] }) =>
  items.length ? (
    <ul className="flex flex-col gap-1 text-base leading-snug">
      {items.map((x, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-2 block size-1.5 shrink-0 bg-lavender-lo" aria-hidden />
          {x}
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-base text-ink-mute">—</p>
  );

export function ProfileView({ profile }: { profile: BehaviorProfile }) {
  const { t, tx } = useI18n();
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="md:col-span-2">
        <Section title={t("analysis.sections.summary")}>
          <p className="text-lg leading-snug">{profile.summary}</p>
        </Section>
      </div>
      <Section title={t("analysis.sections.traits")}>
        <ul className="flex flex-col gap-2">
          {profile.coreTraits.map((c, i) => (
            <li key={i} className="text-base leading-snug">
              <span className="font-head font-bold">{c.label}</span> <span className="bg-well px-1 font-label text-[9px] uppercase text-ink-soft">{tx(`analysis.source.${c.source}`)}</span>
              <span className="block text-ink-soft">{c.evidence}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t("analysis.sections.speech")}>
        <p className="text-base leading-snug">
          {profile.speech.register} <span className="bg-well px-1 font-label text-[9px] uppercase text-ink-soft">{tx(`analysis.length.${profile.speech.length}`)}</span>
        </p>
        {profile.speech.tics.length > 0 && <p className="mt-1 text-base text-ink-soft">{t("analysis.tics")}: {profile.speech.tics.join(" · ")}</p>}
        {profile.speech.avoids.length > 0 && <p className="mt-1 text-base text-ink-soft">{t("analysis.avoids")}: {profile.speech.avoids.join(" · ")}</p>}
        {profile.speech.sample && (
          <p className="mt-2 bg-pink-hi px-2 py-1 text-base italic">
            <span className="mr-1 font-label text-[9px] not-italic uppercase text-rose">{t("analysis.sample")}</span>“{profile.speech.sample}”
          </p>
        )}
      </Section>
      <Section title={t("analysis.sections.emotions")}>
        <ul className="flex flex-col gap-2">
          {profile.emotionalPatterns.map((p, i) => (
            <li key={i} className="text-base leading-snug">
              <span className="font-head font-bold">{p.trigger}</span> → {p.reaction}
              <span className="block text-ink-soft">{t("analysis.but", { text: p.variation })}</span>
            </li>
          ))}
        </ul>
      </Section>
      <div className="flex flex-col gap-6">
        <Section title={t("analysis.sections.decision")}>
          <p className="text-base leading-snug">{profile.decisionStyle}</p>
        </Section>
        <Section title={t("analysis.sections.social")}>
          <p className="text-base leading-snug">{profile.socialStyle}</p>
        </Section>
      </div>
      <Section title={t("analysis.sections.motivations")}>
        <List items={profile.motivations} />
      </Section>
      <Section title={t("analysis.sections.boundaries")}>
        <List items={profile.boundaries} />
      </Section>
      <Section title={t("analysis.sections.approaches")}>
        <p className="flex flex-wrap gap-1.5">
          {profile.dialogueApproaches.map((a) => (
            <span key={a} className="bg-lavender-hi px-1.5 py-0.5 font-head text-sm font-bold text-label">
              {tx(`approaches.${a}`)}
            </span>
          ))}
        </p>
      </Section>
      <Section title={t("analysis.sections.tendencies")}>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
          {REACTIONS.map((r) => (
            <li key={r} className="flex items-center gap-2 text-sm">
              <span className="w-24 shrink-0 truncate">{tx(`reactions.${r}`)}</span>
              <span className="h-2 flex-1 bg-well" aria-hidden>
                <span className="block h-full bg-periwinkle-lo" style={{ width: `${profile.reactionTendencies[r]}%` }} />
              </span>
              <span className="w-7 text-right font-label text-[10px] tabular-nums text-ink-soft">{profile.reactionTendencies[r]}</span>
            </li>
          ))}
        </ul>
      </Section>
      {profile.conflicts.length > 0 && (
        <div className="md:col-span-2">
          <Section title={t("analysis.sections.conflicts")}>
            <ul className="flex flex-col gap-2">
              {profile.conflicts.map((c, i) => (
                <li key={i} className="bg-butter-hi px-2 py-1.5 text-base leading-snug shadow-[inset_4px_0_0_var(--color-butter-lo)]">
                  <span className="font-head font-bold">{c.written}</span> ↔ {c.slider}
                  <span className="block text-ink-soft">{c.note}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
      {profile.storyHooks.length > 0 && (
        <div className="md:col-span-2">
          <Section title={t("analysis.sections.hooks")}>
            <List items={profile.storyHooks} />
          </Section>
        </div>
      )}
    </div>
  );
}

export function AnalysisPanel({ character, onChange }: { character: Character; onChange: (patch: Partial<Character>) => void }) {
  const { t, tx, locale } = useI18n();
  const status = useAiStatus();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const record = character.behavior;
  const hash = profileInputHash(character);
  const stale = record && record.inputHash !== hash;
  const canRun = hasPersonalityInput(character);

  const store = (profile: BehaviorProfile, source: BehaviorRecord["source"]) =>
    onChange({ behavior: { profile, source, status: "pending", inputHash: hash, locale, createdAt: Date.now(), approvedAt: null } });

  const runAi = async () => {
    setRunning(true);
    setError(null);
    try {
      const save = getSave();
      const state = save.story.characters[character.id];
      const profile = await requestAnalysis({
        locale,
        world: save.worldId,
        character: briefFor({ ...character, behavior: null }),
        cast: save.characters.filter((c) => c.id !== character.id).map((c) => ({ name: c.name.slice(0, 80), relationships: c.relationships.slice(0, 800) })),
        mood: state?.mood ?? "calm",
        memories: (state?.memories ?? []).slice(-12).map(memoryBrief),
      });
      store(profile, "ai");
    } catch (e) {
      setError(tx(`ai.errors.${e instanceof AiRequestError ? e.code : "failed"}`));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <Panel title={t("analysis.title")} sparkles={!record}>
        <p className="mb-4 max-w-2xl text-base leading-snug text-ink-soft">{t("analysis.intro")}</p>
        {!canRun && <p className="mb-4 bg-well px-3 py-2 text-base text-ink-soft">{t("analysis.needInput")}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <PixelButton variant="magic" icon="sparkle" loading={running} disabled={!canRun || !status?.text} onClick={runAi}>
            {running ? t("analysis.running") : record?.source === "ai" ? t("analysis.rerun") : t("analysis.run")}
          </PixelButton>
          <PixelButton variant="ghost" icon="gear" disabled={!canRun || running} onClick={() => store(buildLocalProfile(character, locale), "local")}>
            {t("analysis.runLocal")}
          </PixelButton>
        </div>
        {status && !status.text && (
          <p className="mt-3 flex items-start gap-2 text-sm leading-snug text-ink-soft" role="note">
            <PixelIcon name="offline" size={12} className="mt-1 shrink-0 text-coral-deep" />
            <span>
              <span className="font-bold text-ink">{t("analysis.unavailable")}.</span> {t("analysis.unavailableHint")}
            </span>
          </p>
        )}
        {running && (
          <p role="status" className="mt-3 flex items-center gap-2 font-label text-xs uppercase text-ink-soft">
            {t("analysis.running")} <LoadingDots className="text-label" />
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 bg-peach-hi px-3 py-2 text-base text-ink shadow-[inset_4px_0_0_var(--color-peach-lo)]">
            {t("ai.errorTitle", { reason: error })}
          </p>
        )}
        {!record && <p className="mt-4 text-base text-ink-mute">{t("analysis.notUsedYet")}</p>}
      </Panel>

      {record && (
        <Panel
          title={record.source === "ai" ? t("analysis.sourceAi") : t("analysis.sourceLocal")}
          frame={record.status === "approved" ? "gold" : "panel"}
        >
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b-[3px] border-dashed border-line pb-4">
            <p className={`flex items-center gap-2 font-label text-xs uppercase ${record.status === "approved" ? "text-mint-deep" : "text-rose"}`} role="status">
              <PixelIcon name={record.status === "approved" ? "check" : "clock"} size={12} />
              {record.status === "approved" ? t("analysis.approved") : t("analysis.pending")}
            </p>
            <div className="flex flex-wrap gap-2">
              {record.status !== "approved" && (
                <PixelButton size="sm" variant="success" icon="check" onClick={() => onChange({ behavior: { ...record, status: "approved", approvedAt: Date.now() } })}>
                  {t("analysis.approve")}
                </PixelButton>
              )}
              <PixelButton size="sm" variant="ghost" icon="trash" onClick={() => onChange({ behavior: null })}>
                {t("analysis.discard")}
              </PixelButton>
            </div>
          </div>
          {stale && <p className="mb-4 bg-butter-hi px-3 py-2 text-base shadow-[inset_4px_0_0_var(--color-butter-lo)]">{t("analysis.stale")}</p>}
          {record.status !== "approved" && <p className="mb-4 text-base text-ink-soft">{t("analysis.notUsedYet")}</p>}
          <ProfileView profile={record.profile} />
        </Panel>
      )}
    </div>
  );
}
