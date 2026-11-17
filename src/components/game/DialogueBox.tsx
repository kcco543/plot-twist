"use client";

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { PixelButton } from "@/components/ui/PixelButton";
import { LoadingDots } from "@/components/ui/LoadingDots";
import { splitTrailingSpace } from "@/lib/dialogue/typewriter";
import type { Typewriter } from "@/lib/useTypewriter";
import { useI18n } from "@/i18n";
import type { Action } from "@/lib/story/engine";

/**
 * DIALOGUE DOCK — Play Mode's dialogue window, sized to sit beside (desktop)
 * or directly under (phones) the game viewport.
 *
 *   ┌ speaker ─────────────── 2/4 ┐   header (never scrolls)
 *   │ earlier lines (muted)       │   scrolls inside; the current line is
 *   │ current line, typewriter ▼  │   kept at the top of the view
 *   ├─────────────────────────────┤
 *   │ conversation / talk strip   │   `talk`: its choice list scrolls on its own
 *   │ Talk Observe Wait Twist     │   story actions (hidden during a conversation)
 *   └ ◀ Mira · calm · info ▶ ─────┘   `footer`
 *
 * The text area and the choices share the height: long text scrolls inside
 * its own area and never pushes the choices out of the window. Lines also
 * play in the speech bubbles on stage; this dock mirrors the same typewriter
 * (no second timer), so opening other panels never restarts it.
 */
export function DialogueBox({
  speaker,
  text,
  typer,
  onAdvance,
  lineId,
  history = [],
  targetName,
  onAction,
  index,
  total,
  busy,
  note,
  hideActions = false,
  actionsDisabled = false,
  extra,
  talk,
  footer,
  compact = false,
  headerAction,
}: {
  speaker: string;
  text: string;
  /** Shared typewriter state (owned by the play screen). */
  typer: Typewriter;
  /** Finish typing, or go to the next line. */
  onAdvance: () => void;
  /** Changes with every new line (scrolls the new line into view). */
  lineId: string;
  /** Lines already read in this exchange, oldest first. */
  history?: { speaker: string; text: string }[];
  targetName: string | null;
  onAction: (a: Action) => void;
  index: number;
  total: number;
  busy: boolean;
  /** Small status under the line (e.g. "AI writing didn't work"). */
  note?: string | null;
  /** A walk-and-talk conversation is open: its own panel replaces these buttons. */
  hideActions?: boolean;
  actionsDisabled?: boolean;
  /** Cards that belong with the current line (photo / gift moments). Scroll with the text. */
  extra?: ReactNode;
  /** Conversation panel or the talk strip, between the text and the actions. */
  talk?: ReactNode;
  /** Character row at the bottom. */
  footer?: ReactNode;
  /** Short window: tighter spacing. */
  compact?: boolean;
  /** Replaces the "with …" label in the header (short windows: the "Talk to…" button). */
  headerAction?: ReactNode;
}) {
  const { t } = useI18n();
  const { shown, rest, done } = typer;
  const [head, space] = splitTrailingSpace(shown);
  const disabled = !targetName || busy || actionsDisabled;
  const more = index < total - 1;
  const scroller = useRef<HTMLDivElement>(null);
  const currentEl = useRef<HTMLDivElement>(null);
  const caret = useRef<HTMLSpanElement>(null);

  // A new line: put it at the top of the text area (earlier lines stay one scroll up).
  useLayoutEffect(() => {
    const sc = scroller.current;
    const cur = currentEl.current;
    if (sc && cur) sc.scrollTop = Math.max(0, cur.offsetTop - 4);
  }, [lineId, busy]);
  // A line longer than the area: follow the caret while it types.
  useLayoutEffect(() => {
    const sc = scroller.current;
    const c = caret.current;
    if (!sc || !c || done) return;
    const bottom = c.offsetTop + c.offsetHeight + 6;
    if (bottom > sc.scrollTop + sc.clientHeight) sc.scrollTop = bottom - sc.clientHeight;
  }, [shown, done]);

  return (
    <section
      aria-label={t("play.dialogue")}
      data-dialogue-dock
      data-compact={compact || undefined}
      // Very short windows (phone landscape): if even the compact dock can't fit, it scrolls inside itself, never the page.
      className="@container px-frame px-shadow px-panel relative flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain [scrollbar-width:thin]"
      style={{ "--frame": "var(--frame-cream)" } as CSSProperties}
    >
      {/* Speaker header */}
      <div className="dialogue-head panel-pad-x flex shrink-0 items-center gap-2">
        <span className="px-tab min-w-0 max-w-[70%] shrink truncate" style={{ borderImageSource: "var(--frame-pink)" }} data-dialogue-speaker>
          <span className="truncate">{speaker}</span>
        </span>
        <span className="min-w-0 flex-1 truncate text-right font-label text-[10px] uppercase text-ink-soft">
          {total > 1 && <span className="tabular-nums">{t("play.lineCount", { n: index + 1, total })}{headerAction ? "" : " · "}</span>}
          {!headerAction && (targetName ? t("play.with", { name: targetName }) : t("play.selectSomeone"))}
        </span>
        {headerAction}
      </div>

      {/* Dialogue: history + current line. Scrolls inside; keeps a few lines even when choices are long. */}
      <div
        ref={scroller}
        data-dialogue-scroll
        // Content-aware: as tall as the lines need, between ~2.5 lines and (during a conversation) about half the
        // dock, so the choices keep their room. Outside a conversation the text area takes the spare height.
        className={`dialogue-text panel-pad-x relative min-h-[3.4rem] overflow-y-auto overscroll-contain ${hideActions ? "flex-[0_1_auto]" : "flex-[1_1_auto]"}`}
        style={hideActions ? { maxHeight: "50%" } : undefined}
      >
        {history.length > 0 && (
          <ol className="mb-1.5 flex flex-col gap-1" aria-label={t("play.earlierLines")}>
            {history.map((h, i) => (
              <li key={i} className="break-words text-sm leading-snug text-ink-soft">
                <span className="mr-1.5 font-label text-[9px] uppercase text-ink-mute">{h.speaker}</span>
                {h.text}
              </li>
            ))}
          </ol>
        )}
        <div ref={currentEl}>
          <button type="button" onClick={onAdvance} className="px-focus block w-full cursor-pointer text-left" aria-label={done && more ? t("play.nextLine") : t("play.showFullLine")}>
            {/* Screen readers get the whole line once, not every typed character. */}
            {!busy && (
              <span className="sr-only" aria-live="polite">
                {speaker}: {text}
              </span>
            )}
            <p className="dialogue-line m-0 whitespace-pre-line break-words text-[15px] leading-snug text-ink sm:text-[17px]" aria-hidden={!busy}>
              {busy ? (
                <span className="flex items-center gap-2 font-label text-xs uppercase text-ink-soft">
                  {t("play.writing")} <LoadingDots className="text-label" />
                </span>
              ) : (
                <>
                  {head}
                  {!done && <span ref={caret} className="bubble-caret" />}
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
          {note && (
            <p role="status" className="mt-1 break-words text-sm text-coral-deep">
              {note}
            </p>
          )}
        </div>
        {extra && <div className="mt-2 flex flex-col gap-2 pb-1">{extra}</div>}
      </div>

      {/* Conversation / talk strip: its own internal scroll for long choice lists */}
      {/* If even the shrunken choices don't fit (tiny windows), this area scrolls instead of overlapping. */}
      {talk && <div className={`flex min-h-0 flex-col overflow-y-auto overscroll-contain border-t-2 border-dashed border-line ${hideActions ? "flex-1" : "shrink"}`} data-dock-talk>{talk}</div>}

      {!hideActions && (
        <div className="dialogue-actions panel-pad-x grid shrink-0 grid-cols-2 gap-1.5 @[17rem]:grid-cols-4 @[17rem]:[&_svg]:hidden @[17rem]:[&>button]:px-0 @[17rem]:[&>button]:text-[13px] @[24rem]:[&>button]:text-[15px] @[27rem]:[&_svg]:block">
          <PixelButton size="sm" variant="accent" icon="chat" disabled={disabled} onClick={() => onAction("talk")} className="px-1" data-action="talk">
            {t("play.actions.talk")}
          </PixelButton>
          <PixelButton size="sm" variant="magic" icon="eye" disabled={disabled} onClick={() => onAction("observe")} className="px-1" data-action="observe">
            {t("play.actions.observe")}
          </PixelButton>
          <PixelButton size="sm" variant="secondary" icon="clock" disabled={disabled} onClick={() => onAction("wait")} className="px-1" data-action="wait">
            {t("play.actions.wait")}
          </PixelButton>
          <PixelButton size="sm" variant="primary" icon="star" disabled={disabled} onClick={() => onAction("twist")} title={t("play.twistHint")} className="px-1" data-action="twist">
            {t("play.actions.twist")}
          </PixelButton>
        </div>
      )}
      {footer && <div className="shrink-0 border-t-2 border-dashed border-line">{footer}</div>}
    </section>
  );
}
