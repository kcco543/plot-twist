"use client";

import type { ConvoRecord } from "@/lib/autonomy/convo";
import type { Character } from "@/lib/types";
import { useI18n } from "@/i18n";
import { ConvoTranscript, endKey } from "./AutoConvoCard";

const REL_KEYS = ["trust", "affection", "respect", "familiarity", "tension"] as const;

/**
 * Story Log → Conversations: every conversation the characters had on their
 * own in this world, newest first. The transcript is the full record; the
 * "remembered" part lists only what became a long-term memory.
 */
export function ConvoHistory({ records, cast, locale }: { records: ConvoRecord[]; cast: Character[]; locale: string }) {
  const { t } = useI18n();
  if (!records.length) return <p className="text-lg text-ink-soft" data-convo-history-empty>{t("autoTalk.history.empty")}</p>;
  const nameIn = (r: ConvoRecord) => (id: string) => cast.find((c) => c.id === id)?.name.trim() || r.names[r.participants.indexOf(id)] || t("common.unnamed");
  return (
    <ol className="flex flex-col gap-3" data-convo-history>
      {[...records].reverse().map((r, i) => {
        const nameOf = nameIn(r);
        const [a, b] = r.participants.map(nameOf);
        return (
          <li key={r.id} className="bg-well px-3 py-2 shadow-[inset_4px_0_0_var(--color-mint)]" data-convo-record={r.id} data-status={r.status}>
            <details open={i === 0}>
              <summary className="cursor-pointer list-none">
                <p className="font-label text-[10px] uppercase text-rose">
                  {t(`autoTalk.states.${r.status}` as "autoTalk.states.completed")} · {r.place} · {new Date(r.startedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                  {r.source === "ai" && <span className="ml-1 bg-lavender-hi px-1 text-label">AI</span>}
                  {r.source === "mock" && <span className="ml-1 bg-butter-hi px-1 text-ink">TEST</span>}
                  {r.source === "builtin" && <span className="ml-1 bg-surface px-1 text-ink-soft">BUILT-IN</span>}
                </p>
                <p className="text-lg leading-snug">
                  {t("autoTalk.cardTitle", { a, b })} <span className="text-ink-soft">· {t("autoTalk.history.lines", { n: String(r.turns.length) })}</span>
                </p>
                <p className="text-sm text-ink-soft">{r.topic}</p>
              </summary>
              <div className="mt-2 flex flex-col gap-2 border-t-2 border-dashed border-line pt-2">
                <ConvoTranscript turns={r.turns} nameOf={nameOf} />
                {r.endReason && <p className="text-sm text-ink-soft">{t(`autoTalk.ends.${endKey(r.endReason)}` as "autoTalk.ends.natural", { a, b, who: r.leaver ? nameOf(r.leaver) : "" })}</p>}
                {r.changes.length > 0 && (
                  <div>
                    <p className="font-label text-[10px] uppercase text-label">{t("autoTalk.history.changed")}</p>
                    <ul className="text-sm">
                      {r.changes.map((c, k) => (
                        <li key={k}>
                          {t("autoTalk.history.towards", { a: nameOf(c.from), b: nameOf(c.to) })}{" "}
                          {REL_KEYS.filter((x) => c.delta[x])
                            .map((x) => `${t(`autoTalk.rel.${x}` as "autoTalk.rel.trust")} ${c.delta[x]! > 0 ? "+" : ""}${c.delta[x]}`)
                            .join(", ")}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {r.memories.length > 0 && (
                  <div>
                    <p className="font-label text-[10px] uppercase text-label">{t("autoTalk.history.remembered")}</p>
                    <ul className="text-sm">
                      {r.memories.map((m, k) => (
                        <li key={k}>
                          {nameOf(m.holder)}: {m.note}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
