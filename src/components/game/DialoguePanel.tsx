"use client";

import { PixelButton } from "@/components/ui/PixelButton";
import { useTypewriter } from "@/lib/useTypewriter";
import type { Action } from "@/lib/scenes";

export function DialoguePanel({
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
  const { shown, done, skip } = useTypewriter(text, msPerChar);
  const disabled = !targetName;

  return (
    <section className="px-panel" style={{ "--frame": "var(--color-paper)" } as React.CSSProperties} aria-label="Dialogue">
      <button onClick={skip} className="block w-full cursor-pointer p-4 text-left sm:p-5" aria-label="Show full line">
        <span className="inline-block bg-twist px-2 py-1 font-display text-[9px] uppercase text-paper">{speaker}</span>
        <p className="mt-3 min-h-[4.5rem] text-xl leading-snug text-paper" aria-live="polite">
          {shown}
          {!done && <span className="animate-blink text-sun">▌</span>}
          {done && <span className="ml-1 animate-blink text-sun" aria-hidden>▼</span>}
        </p>
      </button>
      <div className="flex flex-wrap items-center gap-4 border-t-4 border-ink-950 bg-ink-900 p-4">
        <span className="mr-auto font-display text-[9px] uppercase text-paper-dim">
          {targetName ? (
            <>
              With <span className="text-sun">{targetName}</span>
            </>
          ) : (
            "Select someone"
          )}
        </span>
        <PixelButton size="sm" variant="accent" icon="chat" disabled={disabled} onClick={() => onAction("talk")}>
          Talk
        </PixelButton>
        <PixelButton size="sm" icon="eye" disabled={disabled} onClick={() => onAction("observe")}>
          Observe
        </PixelButton>
        <PixelButton size="sm" variant="ghost" icon="clock" disabled={disabled} onClick={() => onAction("wait")}>
          Wait
        </PixelButton>
      </div>
    </section>
  );
}
