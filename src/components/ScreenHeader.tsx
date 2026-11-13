import type { ReactNode } from "react";

/** Page title block shared by every in-game screen. */
export function ScreenHeader({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-8 sm:mb-10">
      <p className="font-display text-[10px] uppercase tracking-widest text-twist">{kicker}</p>
      <h1 className="mt-3 font-display text-xl uppercase leading-tight text-paper sm:text-3xl" style={{ textShadow: "3px 3px 0 var(--color-ink-950)" }}>
        {title}
      </h1>
      {children && <div className="mt-3 max-w-2xl text-lg text-paper-dim">{children}</div>}
    </div>
  );
}

/** Sticky bottom bar for BACK / CONTINUE navigation. */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-30 mt-10 border-t-4 border-ink-950 bg-ink-800/95 backdrop-blur-[2px]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">{children}</div>
    </div>
  );
}
