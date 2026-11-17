"use client";

import { Panel } from "@/components/ui/Panel";
import { boundaryOf, cooldownUntil, willingToTalk } from "@/lib/autonomy/convoBoundary";
import type { AgencyState, Intent } from "@/lib/autonomy/types";
import type { Character, StoryState } from "@/lib/types";
import { useI18n } from "@/i18n";

/**
 * Developer view of character autonomy (shown with the test panel): what each
 * character is doing on their own and why, recent intents and how they ended,
 * standing conversation boundaries (and what still blocks talking again), and
 * plans someone said out loud.
 */
export function AutonomyDebug({ story, cast, objectName }: { story: StoryState; cast: Character[]; objectName: (id: string) => string }) {
  const { t, tx } = useI18n();
  const a: AgencyState | undefined = story.agency;
  const name = (id?: string) => cast.find((c) => c.id === id)?.name.trim() || t("common.unnamed");
  const line = (i: Intent) => {
    const what = tx(`autonomy.kinds.${i.kind}`, { target: name(i.target), object: i.object ? objectName(i.object) || i.object : "" });
    const note = i.note ? ` · ${tx(`autonomy.notes.${i.note}`) || i.note}` : "";
    return `${name(i.actor)}: ${what} · ${tx(`autonomy.status.${i.status}`)}${note}`;
  };
  const now = Date.now();
  const boundaries = Object.values(a?.boundaries ?? {}).filter((b) => !b.resolvedAt && cast.some((c) => c.id === b.who) && cast.some((c) => c.id === b.other));
  return (
    <Panel title={t("autonomy.title")}>
      <div className="flex flex-col gap-3 text-sm leading-snug" data-autonomy-debug>
        <p className="text-ink-soft">{t("autonomy.intro")}</p>
        <section>
          <h4 className="mb-1 font-label text-[10px] uppercase text-label">{t("autonomy.active")}</h4>
          {a?.intents.length ? (
            <ul className="flex flex-col gap-1">
              {a.intents.map((i) => (
                <li key={i.id} data-intent={i.kind} data-status={i.status}>
                  {line(i)} <span className="block text-ink-soft">{tx(`autonomy.reasons.${i.reason}`)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-mute">{t("autonomy.nothing")}</p>
          )}
        </section>
        <section>
          <h4 className="mb-1 font-label text-[10px] uppercase text-label">{t("autonomy.recent")}</h4>
          {a?.log.length ? (
            <ul className="flex flex-col gap-1">
              {[...a.log].reverse().slice(0, 6).map((i) => (
                <li key={i.id} data-intent={i.kind} data-status={i.status}>
                  {line(i)} <span className="block text-ink-soft">{tx(`autonomy.reasons.${i.reason}`)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-mute">{t("autonomy.nothing")}</p>
          )}
        </section>
        {boundaries.length > 0 && (
          <section>
            <h4 className="mb-1 font-label text-[10px] uppercase text-label">{t("autonomy.boundaries")}</h4>
            <ul className="flex flex-col gap-1">
              {boundaries.map((b) => {
                const who = cast.find((c) => c.id === b.who)!;
                const other = cast.find((c) => c.id === b.other)!;
                const check = willingToTalk(story, a, who, other, now);
                const left = Math.max(0, Math.ceil((cooldownUntil(boundaryOf(a, b.who, b.other)!, who) - now) / 1000));
                return (
                  <li key={`${b.who}>${b.other}`} data-boundary>
                    {t("autonomy.boundary", { who: name(b.who), other: name(b.other), severity: b.severity, pushes: b.pushes })}
                    <span className="block text-ink-soft">
                      {check.willing ? t("autonomy.ready") : check.blockers.map((k) => tx(`autonomy.why.${k}`) + (k === "cooldown" ? ` (${left}s)` : "")).join(" · ")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {(a?.goals.length ?? 0) > 0 && (
          <section>
            <h4 className="mb-1 font-label text-[10px] uppercase text-label">{t("autonomy.goals")}</h4>
            <ul className="flex flex-col gap-1">
              {[...a!.goals].reverse().slice(0, 4).map((g) => (
                <li key={g.id} data-goal={g.status}>
                  {name(g.actor)}: “{g.text}” → {g.object ? objectName(g.object) || g.place : g.place} · {tx(`autonomy.goalStatus.${g.status}`)}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Panel>
  );
}
