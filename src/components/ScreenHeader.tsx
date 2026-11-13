import type { ReactNode } from "react";

/** Page title block shared by every in-game screen. */
export function ScreenHeader({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-8 sm:mb-10">
      <p className="font-label text-xs uppercase tracking-widest text-pink">{kicker}</p>
      <h1 className="mt-2 font-display text-[28px] font-bold leading-tight text-cream text-balance sm:text-[40px]" style={{ textShadow: "3px 3px 0 var(--color-ink)" }}>
        {title}
      </h1>
      {children && <div className="mt-2 max-w-2xl text-lg text-cream-dim">{children}</div>}
    </div>
  );
}

/** Bottom BACK / CONTINUE bar. Sticky, clears the home indicator; steps aside when the phone keyboard is open. */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="action-bar sticky bottom-0 z-30 mt-10 border-t-[3px] border-ink bg-plum-900/95"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="gutter mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 py-3">{children}</div>
    </div>
  );
}
