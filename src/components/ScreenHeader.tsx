import type { ReactNode } from "react";
import { PixelDivider, Sparkle } from "./ui/Deco";

/** Page title block shared by every in-game screen: kicker pill, title, pixel rule, intro. */
export function ScreenHeader({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-8 sm:mb-10">
      <p className="inline-flex items-center gap-1.5 bg-pink-hi px-2 py-1 font-label text-[11px] uppercase tracking-widest text-rose shadow-[2px_2px_0_var(--color-pink)]">
        <Sparkle size={8} twinkle /> {kicker}
      </p>
      <h1
        className="mt-3 font-display text-[28px] font-bold leading-tight text-ink text-balance sm:text-[40px]"
        style={{ textShadow: "2px 2px 0 var(--color-lavender-hi), 3px 3px 0 var(--color-lavender)" }}
      >
        {title}
      </h1>
      <PixelDivider className="mt-3" />
      {children && <div className="mt-3 max-w-2xl text-lg leading-snug text-ink-soft">{children}</div>}
    </div>
  );
}

/** Bottom BACK / CONTINUE bar. Sticky, scalloped top, clears the home indicator; steps aside when the phone keyboard is open. */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="action-bar px-scallop sticky bottom-0 z-30 mt-12 bg-surface/95 shadow-[0_-6px_16px_rgba(91,74,134,0.08)] backdrop-blur-sm"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="gutter mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 py-3">{children}</div>
    </div>
  );
}
