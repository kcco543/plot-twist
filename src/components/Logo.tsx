"use client";

import { useI18n } from "@/i18n";

/** The wordmark is always Latin. In Chinese, a subtitle is added under it. */
export function Logo({ size = "lg" }: { size?: "sm" | "lg" }) {
  const { t } = useI18n();
  if (size === "sm") {
    return (
      <span className="font-shout text-[11px] leading-none text-cream sm:text-sm" style={{ textShadow: "2px 2px 0 var(--color-pink-lo)" }}>
        PLOT <span className="text-butter">TWIST!</span>
      </span>
    );
  }
  const subtitle = t("title.subtitle");
  return (
    <div className="flex select-none flex-col items-center">
      <h1 className="text-center font-shout leading-[1.05]" aria-label="PLOT TWIST!">
        <span
          className="block text-[42px] text-cream min-[400px]:text-5xl sm:text-7xl lg:text-8xl"
          style={{ textShadow: "4px 4px 0 var(--color-pink), 8px 8px 0 var(--color-ink)" }}
        >
          PLOT
        </span>
        <span
          className="mt-2 inline-block -rotate-3 text-[42px] text-butter min-[400px]:text-5xl sm:mt-4 sm:text-7xl lg:text-8xl"
          style={{ textShadow: "4px 4px 0 var(--color-pink-lo), 8px 8px 0 var(--color-ink)" }}
        >
          TWIST
          <span className="inline-block rotate-12 text-pink" style={{ textShadow: "4px 4px 0 var(--color-ink)" }}>
            !
          </span>
        </span>
      </h1>
      {subtitle && (
        <p className="mt-4 rotate-2 bg-pink px-3 py-1 font-display text-xl text-ink shadow-[4px_4px_0_var(--color-ink)] sm:text-2xl">{subtitle}</p>
      )}
    </div>
  );
}
