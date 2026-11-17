"use client";

import { useEffect, useRef } from "react";
import type { AutoConvo, ConvoRecord, ConvoTurn } from "@/lib/autonomy/convo";
import type { Character } from "@/lib/types";
import { useI18n } from "@/i18n";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { useTurnText } from "./AutoConvoLayer";

const sourceTag = (s: AutoConvo["source"]) =>
  s === "ai" ? <span className="ml-1 bg-lavender-hi px-1 text-label">AI</span> : s === "mock" ? <span className="ml-1 bg-butter-hi px-1 text-ink">TEST</span> : s === "builtin" ? <span className="ml-1 bg-well px-1 text-ink-soft" data-builtin>BUILT-IN</span> : null;

/** The transcript of one conversation (live session or saved record), oldest line first. */
export function ConvoTranscript({ turns, nameOf, live }: { turns: ConvoTurn[]; nameOf: (id: string) => string; live?: boolean }) {
  const { t } = useI18n();
  const text = useTurnText();
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (live) end.current?.scrollIntoView({ block: "nearest" });
  }, [live, turns.length]);
  if (!turns.length) return <p className="text-base text-ink-soft">{t("autoTalk.noLinesYet")}</p>;
  return (
    <ol className="flex flex-col gap-1.5" data-convo-transcript>
      {turns.map((x, i) => (
        <li key={i} ref={i === turns.length - 1 ? end : undefined} className="text-base leading-snug">
          <span className="font-label text-[10px] uppercase text-rose">{nameOf(x.speaker)}</span>
          {x.emotion !== "neutral" && x.level > 0 && <span className="ml-1 font-label text-[10px] uppercase text-ink-mute">· {t(`emotions.${x.emotion}` as "emotions.happy")}</span>}
          <span className="block">{text(x)}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Inspect a conversation the characters are having on their own: who, how
 * it's going, every line so far. Opened by clicking either participant or
 * the talking indicator. Focusing the camera is the player's choice.
 */
export function AutoConvoCard({ session, record, cast, onFocus, onClose }: { session: AutoConvo | null; record: ConvoRecord | null; cast: Character[]; onFocus: (id: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const nameOf = (id: string) => cast.find((c) => c.id === id)?.name.trim() || record?.names[record.participants.indexOf(id)] || t("common.unnamed");
  const parts = session?.participants ?? record?.participants;
  if (!parts) return null;
  const status = session ? session.state : (record?.status ?? "completed");
  const turns = session?.turns ?? record?.turns ?? [];
  const source = session?.source ?? record?.source ?? null;
  const reason = session?.reason ?? record?.reason ?? "chats";
  return (
    <div
      role="dialog"
      aria-label={t("autoTalk.cardTitle", { a: nameOf(parts[0]), b: nameOf(parts[1]) })}
      data-auto-convo-card={session?.id ?? record?.id}
      className="pointer-events-auto absolute left-2 top-2 z-20 flex max-h-[min(70%,22rem)] w-[min(22rem,calc(100%-1rem))] flex-col bg-surface p-3 shadow-[0_0_0_3px_var(--color-line),4px_4px_0_0_rgba(var(--shadow-rgb),0.25)]"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1 font-label text-[10px] uppercase text-label">
            <PixelIcon name="chat" size={10} /> {t(`autoTalk.states.${status}` as "autoTalk.states.active")}
            {sourceTag(source)}
          </p>
          <h2 className="truncate font-head text-lg font-bold">{t("autoTalk.cardTitle", { a: nameOf(parts[0]), b: nameOf(parts[1]) })}</h2>
          <p className="text-sm text-ink-soft">{t(`autoTalk.reasons.${reason}` as "autoTalk.reasons.chats", { a: nameOf(parts[0]), b: nameOf(parts[1]) })}</p>
        </div>
        <PixelButton size="sm" variant="ghost" icon="close" onClick={onClose} aria-label={t("common.close")} className="min-w-11 shrink-0" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        <ConvoTranscript turns={turns} nameOf={nameOf} live={!!session} />
        {session?.writing && <p className="mt-2 font-label text-[10px] uppercase text-ink-mute" data-writing>{t("autoTalk.writing")}</p>}
        {source === "builtin" && <p className="mt-2 text-sm text-ink-soft">{t("autoTalk.builtinNote")}</p>}
        {record && record.endReason && <p className="mt-2 text-sm text-ink-soft">{t(`autoTalk.ends.${endKey(record.endReason)}` as "autoTalk.ends.natural", { a: nameOf(parts[0]), b: nameOf(parts[1]), who: record.leaver ? nameOf(record.leaver) : "" })}</p>}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <PixelButton size="sm" variant="calm" icon="eye" onClick={() => onFocus(session?.speaker ?? parts[0])} data-focus-convo>
          {t("autoTalk.focus")}
        </PixelButton>
      </div>
    </div>
  );
}

/** Group detailed end reasons (ai_billing, declined_shy…) into the few the player reads. */
export function endKey(reason: string): string {
  if (reason.startsWith("ai_")) return "ai";
  if (reason.startsWith("declined_")) return reason;
  return ["natural", "walkedOff", "player", "scene_change", "reload", "timeout", "unreachable", "left", "busy", "too_long"].includes(reason) ? reason : "other";
}
