"use client";

import { PixelButton } from "@/components/ui/PixelButton";
import { LoadingDots } from "@/components/ui/LoadingDots";
import { splitTrailingSpace } from "@/lib/dialogue/typewriter";
import type { Typewriter } from "@/lib/useTypewriter";
import { useI18n } from "@/i18n";
import type { Action } from "@/lib/story/engine";

/**
 * Cream dialogue panel with a speaker nameplate, typewriter text and big
 * tap-friendly choices. Lines also appear in speech bubbles above the speaker
 * on stage; this panel mirrors the same line (same typewriter, no second
 * timer) for narration, accessibility and players who prefer reading here.
 * Tap to finish the typing, tap again for the next line.
 */
export function DialogueBox({
  speaker,
  text,
  typer,
  onAdvance,
  targetName,
  onAction,
  index,
  total,
  busy,
  note,
  hideActions = false,
  actionsDisabled = false,
}: {
  speaker: string;
  text: string;
  /** Shared typewriter state (owned by the play screen). */
  typer: Typewriter;
  /** Finish typing, or go to the next line. */
  onAdvance: () => void;
  targetName: string | null;
  onAction: (a: Action) => void;
  index: number;
  total: number;
  busy: boolean;
  /** Small status under the box (e.g. "AI writing didn't work"). */
  note?: string | null;
  /** A walk-and-talk conversation is open: its own panel replaces these buttons. */
  hideActions?: boolean;
  actionsDisabled?: boolean;
}) {
  const { t } = useI18n();
  const { shown, rest, done } = typer;
  const [head, space] = splitTrailingSpace(shown);
  const disabled = !targetName || busy || actionsDisabled;
  const more = index < total - 1;

  return (
    <section aria-label={t("play.dialogue")} className={`mt-5 grid gap-[var(--stack-gap)] ${hideActions ? "" : "xl:grid-cols-[minmax(0,1fr)_16rem]"} xl:items-start xl:gap-4`}>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="content-block px-frame px-shadow relative" style={{ "--frame": "var(--frame-cream)" } as React.CSSProperties}>
          <span className="px-tab absolute -top-7 left-[calc(var(--u)*-4)] sm:-top-8" style={{ borderImageSource: "var(--frame-pink)" }}>
            {speaker}
          </span>
          {total > 1 && <span className="absolute right-[calc(var(--u)*-4)] -top-6 bg-surface px-1 font-label text-[10px] text-ink-soft tabular-nums sm:-top-7">{t("play.lineCount", { n: index + 1, total })}</span>}
          <button onClick={onAdvance} className="panel-pad-x block w-full cursor-pointer pt-2 pb-0.5 text-left" aria-label={done && more ? t("play.nextLine") : t("play.showFullLine")}>
            {/* Screen readers get the whole line once, not every typed character. */}
            {!busy && (
              <span className="sr-only" aria-live="polite">
                {speaker}: {text}
              </span>
            )}
            <p className="min-h-[2.75rem] whitespace-pre-wrap break-words text-[15px] leading-snug text-ink sm:min-h-[3.5rem] sm:text-lg" aria-hidden={!busy}>
              {busy ? (
                <span className="flex items-center gap-2 font-label text-xs uppercase text-ink-soft">
                  {t("play.writing")} <LoadingDots className="text-label" />
                </span>
              ) : (
                <>
                  {head}
                  {!done && <span className="bubble-caret" />}
                  {space}
                  {rest && <span className="invisible">{rest}</span>}
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
        <div className="plain-pad-x flex min-h-5 items-center justify-between gap-2">
          <span className="min-w-0 truncate font-label text-[10px] uppercase text-ink-soft">{targetName ? t("play.with", { name: targetName }) : t("play.selectSomeone")}</span>
          {note && (
            <span role="status" className="min-w-0 truncate text-sm text-coral-deep">
              {note}
            </span>
          )}
        </div>
      </div>
      {!hideActions && (
      <div className="content-block grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
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
      )}
    </section>
  );
}
