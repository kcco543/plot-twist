"use client";

import { PixelButton } from "@/components/ui/PixelButton";
import { useTypewriter } from "@/lib/useTypewriter";
import { useI18n } from "@/i18n";
import type { Action } from "@/lib/scenes";

/** Cream speech window with a speaker nameplate, typewriter text and big tap-friendly choices. */
export function DialogueBox({
  speaker,
  text,
  msPerChar,
  targetName,
  onAction,
}: {
  speaker: string;
  text: string;
  msPerChar: number;
  targetName: string | null;
  onAction: (a: Action) => void;
}) {
  const { t } = useI18n();
  const { shown, done, skip } = useTypewriter(text, msPerChar);
  const disabled = !targetName;

  return (
    <section aria-label={t("play.dialogue")} className="mt-5 flex flex-col gap-3">
      <div className="px-frame px-shadow relative" style={{ "--frame": "var(--frame-cream)" } as React.CSSProperties}>
        <span className="px-tab absolute -top-7 left-1 sm:-top-8" style={{ borderImageSource: "var(--frame-pink)" }}>
          {speaker}
        </span>
        <button onClick={skip} className="block w-full cursor-pointer px-1 pt-3 pb-1 text-left" aria-label={t("play.showFullLine")}>
          <p className="min-h-[4.5rem] text-lg leading-snug text-ink sm:text-xl" aria-live="polite">
            {shown}
            {!done && <span className="animate-cursor text-pink-lo">▌</span>}
            {done && (
              <span className="ml-1 inline-block animate-bob text-pink-lo" aria-hidden>
                ▼
              </span>
            )}
          </p>
        </button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-label text-[10px] uppercase text-cream-dim">
          {targetName ? t("play.with", { name: targetName }) : t("play.selectSomeone")}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <PixelButton variant="accent" icon="chat" disabled={disabled} onClick={() => onAction("talk")}>
          {t("play.actions.talk")}
        </PixelButton>
        <PixelButton variant="magic" icon="eye" disabled={disabled} onClick={() => onAction("observe")}>
          {t("play.actions.observe")}
        </PixelButton>
        <PixelButton variant="secondary" icon="clock" disabled={disabled} onClick={() => onAction("wait")}>
          {t("play.actions.wait")}
        </PixelButton>
      </div>
    </section>
  );
}
