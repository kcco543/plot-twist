"use client";

/**
 * Walk-and-talk UI under the dialogue box:
 *
 *  TalkStrip          how to start (drag hint + "Talk to…" for tap-to-target),
 *                     the target list, the walking status + Cancel, and feedback
 *                     when something didn't work.
 *  ConversationPanel  once the two are facing each other: who's talking, their
 *                     relationship, the listener's mood, 2–3 suggested topics,
 *                     "Ask Something Else" (composer) and End conversation.
 *
 * The lines themselves play in the speech bubbles and the dialogue box above.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { useI18n } from "@/i18n";
import { emotionOf } from "@/lib/emotion/emotions";
import { relationOf } from "@/lib/mind/relations";
import { personalityOf } from "@/lib/mind/profile";
import { bondBetween } from "@/lib/stage/behavior";
import { CHOOSING_PHASES, type TalkNotice, type TalkSession } from "@/lib/talk/flow";
import { CUSTOM_MAX, cleanMessage } from "@/lib/talk/customReply";
import { relationWords, talkVars } from "@/lib/talk/text";
import type { TalkController } from "@/lib/talk/useTalk";
import type { Character, StoryState } from "@/lib/types";

const nameOf = (cast: Character[], id: string | null, fallback: string) => {
  const c = id ? cast.find((x) => x.id === id) : null;
  return c ? c.name.trim() || fallback : fallback;
};

export function TalkStrip({
  talk,
  cast,
  selectedId,
  touch,
}: {
  talk: TalkController;
  cast: Character[];
  selectedId: string | null;
  /** Touch device: explain touch-and-hold instead of dragging with a mouse. */
  touch: boolean;
}) {
  const { t } = useI18n();
  const s = talk.session;
  const unnamed = t("common.unnamed");
  const name = (id: string | null) => nameOf(cast, id, unnamed);

  if (s?.phase === "SELECT_TARGET") {
    const others = cast.filter((c) => c.id !== s.actorId);
    return (
      <section aria-label={t("talk.chooseFor", { name: name(s.actorId) })} className="content-block flex flex-col gap-2 bg-lavender-hi px-3 py-2.5 shadow-[inset_4px_0_0_var(--color-lavender)]">
        <p className="font-head text-base font-bold leading-tight">{t("talk.chooseFor", { name: name(s.actorId) })}</p>
        <p className="text-sm text-ink-soft">{t("talk.chooseHelp")}</p>
        <div className="flex flex-wrap gap-2">
          {others.map((c) => (
            <PixelButton key={c.id} size="sm" variant="calm" icon="chat" onClick={() => talk.startWalk(s.actorId, c.id, "tap")} className="px-2">
              {c.name.trim() || unnamed}
            </PixelButton>
          ))}
          <PixelButton size="sm" variant="ghost" icon="close" onClick={talk.cancel} className="px-2">
            {t("talk.cancel")}
          </PixelButton>
        </div>
      </section>
    );
  }

  if (s?.phase === "MOVE_TO_TARGET") {
    return (
      <section role="status" className="content-block flex items-center justify-between gap-2 bg-mint-hi px-3 py-2 shadow-[inset_4px_0_0_var(--color-mint)]">
        <p className="flex min-w-0 items-center gap-2 text-base">
          <PixelIcon name="right" size={12} className="shrink-0 animate-bob text-mint-deep" />
          <span className="min-w-0">{t("talk.walking", { name: name(s.actorId), other: name(s.targetId) })}</span>
        </p>
        <PixelButton size="sm" variant="ghost" icon="close" onClick={talk.cancel} className="shrink-0 px-2">
          {t("talk.cancel")}
        </PixelButton>
      </section>
    );
  }

  if (s) return null; // the conversation panel takes over

  return (
    <div className="content-block flex flex-col gap-2">
      {talk.notice && <Notice notice={talk.notice} onDismiss={talk.dismissNotice} />}
      <div className="plain-pad-x flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="flex min-w-0 flex-1 basis-56 items-center gap-2 text-sm text-ink-soft">
          <PixelIcon name="chat" size={12} className="shrink-0 text-label" />
          <span>{touch ? t("talk.hintTouch") : t("talk.hint")}</span>
        </p>
        <PixelButton size="sm" variant="calm" icon="chat" disabled={!selectedId || cast.length < 2} onClick={() => selectedId && talk.beginSelect(selectedId)} title={selectedId ? undefined : t("talk.chooseNeedsSelection")} className="shrink-0 px-2">
          {selectedId ? `${name(selectedId)}: ${t("talk.chooseButton")}` : t("talk.chooseButton")}
        </PixelButton>
      </div>
    </div>
  );
}

function Notice({ notice, onDismiss }: { notice: TalkNotice; onDismiss: () => void }) {
  const { t } = useI18n();
  const soft = notice.kind === "ended" || notice.kind === "cancelled" || notice.kind === "emptySpace" || notice.kind === "nearby" || notice.kind === "goingTo" || notice.kind === "walkedAway";
  return (
    <p
      role="status"
      className={`flex items-start justify-between gap-2 px-3 py-2 text-base ${soft ? "bg-butter-hi shadow-[inset_4px_0_0_var(--color-butter-lo)]" : "bg-peach-hi text-ink shadow-[inset_4px_0_0_var(--color-coral)]"}`}
    >
      <span className="min-w-0">{t(`talk.notices.${notice.kind}`, { name: notice.actor || t("common.someone"), other: notice.target || t("common.someone") })}</span>
      <button type="button" onClick={onDismiss} className="px-focus -m-1 shrink-0 p-1 text-ink-soft" aria-label={t("talk.dismiss")}>
        <PixelIcon name="close" size={10} />
      </button>
    </p>
  );
}

export function ConversationPanel({
  talk,
  cast,
  story,
  lineInProgress,
  aiMode,
}: {
  talk: TalkController;
  cast: Character[];
  story: StoryState;
  lineInProgress: boolean;
  /** Who answers: Claude, developer TEST replies, or the built-in rules. */
  aiMode: "ai" | "mock" | null;
}) {
  const { t, tx, locale } = useI18n();
  const s = talk.session;
  const box = useRef<HTMLElement>(null);
  // A reply taking a while: say so (slow connection), so the wait never looks like a freeze.
  const waiting = s?.phase === "WAIT_FOR_RESPONSE" && !!aiMode;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!waiting) return;
    const timer = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, [waiting, s?.round]);
  const open = !!s && (s.phase === "FACE_TARGET" || s.phase === "SHOW_OPTIONS");
  // Phones: the panel opens below the dialogue; bring it into view once.
  useEffect(() => {
    if (open) box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open, s?.id]);
  if (!s || !s.targetId || s.phase === "SELECT_TARGET" || s.phase === "MOVE_TO_TARGET") return null;
  const me = cast.find((c) => c.id === s.actorId);
  const them = cast.find((c) => c.id === s.targetId);
  if (!me || !them) return null;
  const unnamed = t("common.unnamed");
  const myName = me.name.trim() || unnamed;
  const theirName = them.name.trim() || unnamed;

  // Relationship as the speaker sees it; the listener's mood as it shows on their face.
  const rel = relationOf(story, me, them, bondBetween(story, me.id, them.id));
  const words = relationWords(rel);
  const mood = emotionOf(story.characters[them.id]);
  const q = personalityOf(them);
  const unreadable = mood.emotion === "neutral" && (q.hides > 0 || q.reserved >= 0.7);
  const choosing = CHOOSING_PHASES.includes(s.phase) && !lineInProgress;
  const status =
    s.phase === "FACE_TARGET"
      ? null
      : s.phase === "SPEAK"
        ? t("talk.panel.speaking", { other: theirName })
        : s.phase === "WAIT_FOR_RESPONSE"
          ? aiMode
            ? slow
              ? t("talk.ai.slow", { other: theirName })
              : t("talk.ai.thinking", { other: theirName })
            : t("talk.panel.answering", { other: theirName })
          : s.phase === "CONTINUE_OR_EXIT" && s.round > 0
            ? t("talk.panel.continue")
            : null;

  return (
    <section ref={box} aria-label={t("talk.panel.title")} className="content-block px-frame px-shadow relative mt-6" style={{ "--frame": "var(--frame-card)" } as CSSProperties} data-conversation-panel>
      <span className="px-tab absolute -top-7 left-[calc(var(--u)*-4)] sm:-top-8" style={{ borderImageSource: "var(--frame-lavender)" }}>
        {t("talk.panel.title")}
      </span>
      <div className="panel-pad-x flex flex-col gap-3 pb-1 pt-2">
        {/* Who, relationship, mood */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 font-head text-lg font-bold leading-tight">
              {t("talk.panel.pair", { name: myName, other: theirName })}
              <span
                data-reply-mode={aiMode ?? "builtin"}
                title={t(aiMode === "ai" ? "talk.ai.modeAiDesc" : aiMode === "mock" ? "talk.ai.modeMockDesc" : "talk.ai.modeOffDesc")}
                className={`px-1.5 py-0.5 font-label text-[9px] font-normal uppercase ${aiMode === "ai" ? "bg-lavender-hi text-label" : aiMode === "mock" ? "bg-butter-hi text-ink" : "bg-well text-ink-soft"}`}
              >
                {t(aiMode === "ai" ? "talk.ai.modeAi" : aiMode === "mock" ? "talk.ai.modeMock" : "talk.ai.modeOff")}
              </span>
            </p>
            <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-sm">
              <dt className="font-label text-[10px] uppercase leading-5 text-ink-mute">{t("talk.panel.relationship")}</dt>
              <dd className="min-w-0" title={t("talk.panel.relationshipOf", { name: myName, other: theirName })}>
                <span className="font-bold">{tx(`talk.relation.labels.${words.label}`)}</span>
                <span className="text-ink-soft"> · {words.words.map((w) => tx(`talk.relation.${w}`)).join(locale === "en" ? ", " : "、")}</span>
              </dd>
              <dt className="font-label text-[10px] uppercase leading-5 text-ink-mute">{t("talk.panel.mood", { other: theirName })}</dt>
              <dd className="min-w-0 font-bold" data-mood={unreadable ? "unknown" : mood.emotion}>
                {unreadable ? <span className="font-normal italic text-ink-soft">{t("talk.panel.hardToRead")}</span> : tx(`emotions.${mood.emotion}`)}
              </dd>
            </dl>
          </div>
          <PixelButton size="sm" variant="ghost" icon="close" onClick={talk.endConversation} className="shrink-0 px-2">
            {t("talk.panel.end")}
          </PixelButton>
        </div>

        {s.customPending && (
          <p role="status" className="flex items-start gap-2 bg-lavender-hi px-3 py-2 text-sm shadow-[inset_4px_0_0_var(--color-lavender)]" data-ai-pending>
            <PixelIcon name="sparkle" size={12} className="mt-1 shrink-0 text-label" />
            <span>{t("talk.ai.offTyped", { other: theirName })}</span>
          </p>
        )}

        {s.aiError && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 bg-peach-hi px-3 py-2 text-sm shadow-[inset_4px_0_0_var(--color-coral)]" data-ai-error={s.aiError}>
            <p className="min-w-0 flex-1 basis-56">
              <span className="font-bold">{t("talk.ai.failed", { other: theirName })}</span> {tx(`ai.errors.${s.aiError}`)}
              {s.replySource === "builtin" && <> {t("talk.ai.usedBuiltin")}</>}
            </p>
            {s.canRetry && (
              <PixelButton size="sm" variant="calm" icon="chat" disabled={!choosing} onClick={talk.retry} className="shrink-0 px-2" data-ai-retry>
                {t("talk.ai.retry")}
              </PixelButton>
            )}
          </div>
        )}

        {status && (
          <p role="status" className="font-label text-[10px] uppercase leading-relaxed text-ink-soft">
            {status}
          </p>
        )}

        {s.phase === "FACE_TARGET" ? null : s.composing ? (
          <Composer session={s} talk={talk} name={myName} other={theirName} disabled={!choosing} />
        ) : (
          <div>
            <p className="mb-1.5 font-label text-[10px] uppercase text-ink-mute">{t("talk.panel.suggested")}</p>
            <ul className="grid gap-2 sm:grid-cols-2" aria-busy={!choosing}>
              {s.aiTopics.map((sug, i) => (
                <li key={`ai-${s.round}-${i}`}>
                  <button
                    type="button"
                    disabled={!choosing}
                    onClick={() => talk.chooseSuggestion(sug)}
                    data-topic="ai"
                    data-intent={sug.intent}
                    title={sug.line}
                    className="px-focus group flex min-h-12 w-full flex-col items-start justify-center bg-surface px-3 py-1.5 text-left shadow-[inset_0_0_0_2px_var(--color-lavender),inset_0_-4px_0_var(--color-lavender)] transition-colors enabled:hover:bg-lavender-hi enabled:active:translate-y-px disabled:opacity-50"
                  >
                    <span className="text-[15px] font-bold leading-snug text-ink sm:text-base">{sug.label}</span>
                    <span className="flex items-center gap-1 text-xs text-ink-soft">
                      <PixelIcon name="sparkle" size={8} className="shrink-0 text-label" />
                      {tx(`talk.ai.intents.${sug.intent}`)}
                      {s.replySource === "mock" ? " · TEST" : ""}
                    </span>
                  </button>
                </li>
              ))}
              {s.topics.map((topic) => {
                const vars = talkVars({ ...topic.vars, other: theirName, name: myName }, locale);
                return (
                  <li key={topic.id}>
                    <button
                      type="button"
                      disabled={!choosing}
                      onClick={() => talk.chooseTopic(topic)}
                      data-topic={topic.id}
                      className="px-focus group flex min-h-12 w-full flex-col items-start justify-center bg-surface px-3 py-1.5 text-left shadow-[inset_0_0_0_2px_var(--color-line),inset_0_-4px_0_var(--color-line)] transition-colors enabled:hover:bg-butter-hi enabled:active:translate-y-px disabled:opacity-50"
                    >
                      <span className="text-[15px] font-bold leading-snug text-ink sm:text-base">{tx(`talk.topics.${topic.id}`, vars)}</span>
                      <span className="text-xs text-ink-soft">{tx(`talk.reasons.${topic.reason}`, vars)}</span>
                    </button>
                  </li>
                );
              })}
              <li>
                <button
                  type="button"
                  disabled={!choosing}
                  onClick={talk.openComposer}
                  data-topic="askElse"
                  className="px-focus flex min-h-12 w-full items-center gap-2 bg-lavender-hi px-3 py-1.5 text-left shadow-[inset_0_0_0_2px_var(--color-lavender),inset_0_-4px_0_var(--color-lavender)] transition-colors enabled:hover:bg-lavender enabled:active:translate-y-px disabled:opacity-50"
                >
                  <PixelIcon name="pencil" size={12} className="shrink-0 text-label" />
                  <span className="text-[15px] font-bold text-ink sm:text-base">{t("talk.panel.askElse")}</span>
                  {s.draft && <span className="ml-auto h-2 w-2 shrink-0 bg-rose" aria-hidden />}
                </button>
              </li>
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function Composer({ session, talk, name, other, disabled }: { session: TalkSession; talk: TalkController; name: string; other: string; disabled: boolean }) {
  const { t } = useI18n();
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    area.current?.focus({ preventScroll: false });
    const el = area.current;
    if (el) el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const count = Array.from(session.draft).length;
  const ready = cleanMessage(session.draft).length > 0;
  const send = () => {
    if (!ready || disabled) return;
    talk.sendCustom();
  };
  const id = `composer-${session.id}`;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label htmlFor={id} className="font-head text-base font-bold">
        {t("talk.composer.label", { name, other })}
      </label>
      <textarea
        ref={area}
        id={id}
        rows={2}
        lang="und"
        value={session.draft}
        maxLength={CUSTOM_MAX * 2}
        placeholder={t("talk.composer.placeholder")}
        onChange={(e) => talk.setDraft(Array.from(e.target.value).slice(0, CUSTOM_MAX).join(""))}
        onKeyDown={(e) => {
          // Keys typed here never reach the game (no movement / dialogue shortcuts).
          e.stopPropagation();
          if (e.nativeEvent.isComposing || e.keyCode === 229) return; // IME (Chinese input) is choosing characters
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          } else if (e.key === "Escape") {
            e.preventDefault();
            talk.closeComposer();
          }
        }}
        className="px-focus w-full resize-y bg-well px-3 py-2 text-lg leading-snug text-ink shadow-[inset_0_0_0_2px_var(--color-line)] placeholder:text-ink-mute"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-label text-[10px] uppercase text-ink-mute">
          <span className="tabular-nums">{t("talk.composer.count", { n: count, max: CUSTOM_MAX })}</span>
          <span className="hidden lg:inline"> · {t("talk.composer.hint")}</span>
        </span>
        <div className="flex gap-2">
          <PixelButton type="button" size="sm" variant="ghost" icon="close" onClick={talk.closeComposer} className="px-2">
            {t("talk.composer.cancel")}
          </PixelButton>
          <PixelButton type="submit" size="sm" variant="primary" icon="chat" disabled={!ready || disabled} className="px-3">
            {t("talk.composer.send")}
          </PixelButton>
        </div>
      </div>
    </form>
  );
}
