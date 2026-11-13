"use client";

import { PixelButton } from "@/components/ui/PixelButton";
import { LoadingDots } from "@/components/ui/LoadingDots";
import { useTypewriter } from "@/lib/useTypewriter";
import { useI18n } from "@/i18n";
import type { Action } from "@/lib/story/engine";

/**
 * Cream speech window with a speaker nameplate, typewriter text and big
 * tap-friendly choices. A beat can have several lines: tap to skip the
 * typing, tap again for the next line.
 */
export function DialogueBox({
  speaker,
  text,
  msPerChar,
  targetName,
  onAction,
  index,
  total,
  onNext,
  busy,
  note,
}: {
  speaker: string;
  text: string;
  msPerChar: number;
  targetName: string | null;
  onAction: (a: Action) => void;
  index: number;
  total: number;
  onNext: () => void;
  busy: boolean;
  /** Small status under the box (e.g. "AI writing didn't work"). */
  note?: string | null;
}) {
  const { t } = useI18n();
  const { shown, done, skip } = useTypewriter(text, msPerChar);
  const disabled = !targetName || busy;
  const more = index < total - 1;

  return (
    <section aria-label={t("play.dialogue")} className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_16rem] xl:items-start xl:gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="px-frame px-shadow relative" style={{ "--frame": "var(--frame-cream)" } as React.CSSProperties}>
          <span className="px-tab absolute -top-7 left-1 sm:-top-8" style={{ borderImageSource: "var(--frame-pink)" }}>
            {speaker}
          </span>
          {total > 1 && <span className="absolute right-1 -top-6 bg-surface px-1 font-label text-[10px] text-ink-soft tabular-nums sm:-top-7">{t("play.lineCount", { n: index + 1, total })}</span>}
          <button onClick={() => (done ? more && onNext() : skip())} className="block w-full cursor-pointer px-1 pt-3 pb-1 text-left" aria-label={done && more ? t("play.nextLine") : t("play.showFullLine")}>
            <p className="min-h-[4.5rem] text-lg leading-snug text-ink sm:text-xl" aria-live="polite">
              {busy ? (
                <span className="flex items-center gap-2 font-label text-xs uppercase text-ink-soft">
                  {t("play.writing")} <LoadingDots className="text-label" />
                </span>
              ) : (
                <>
                  {shown}
                  {!done && <span className="animate-cursor text-rose">▌</span>}
                  {done && (
                    <span className="ml-1 inline-block animate-bob text-rose" aria-hidden>
                      {more ? "▼" : "■"}
                    </span>
                  )}
                </>
              )}
            </p>
          </button>
        </div>
        <div className="flex min-h-5 items-center justify-between gap-2">
          <span className="min-w-0 truncate font-label text-[10px] uppercase text-ink-soft">{targetName ? t("play.with", { name: targetName }) : t("play.selectSomeone")}</span>
          {note && (
            <span role="status" className="min-w-0 truncate text-sm text-coral-deep">
              {note}
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
        <PixelButton variant="accent" icon="chat" disabled={disabled} onClick={() => onAction("talk")} className="px-1">
          {t("play.actions.talk")}
        </PixelButton>
        <PixelButton variant="magic" icon="eye" disabled={disabled} onClick={() => onAction("observe")} className="px-1">
          {t("play.actions.observe")}
        </PixelButton>
        <PixelButton variant="secondary" icon="clock" disabled={disabled} onClick={() => onAction("wait")} className="px-1">
          {t("play.actions.wait")}
        </PixelButton>
        <PixelButton variant="primary" icon="star" disabled={disabled} onClick={() => onAction("twist")} title={t("play.twistHint")} className="px-1">
          {t("play.actions.twist")}
        </PixelButton>
      </div>
    </section>
  );
}
