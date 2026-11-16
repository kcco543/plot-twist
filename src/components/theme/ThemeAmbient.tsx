"use client";

import { BASES, type WorldUiTheme } from "@/lib/theme/themes";

/** Spots in the wide-screen margins only (outside the 72rem content grid). */
const SPOTS = [
  { left: "2.5%", top: "18%", delay: 0 },
  { right: "3%", top: "32%", delay: 1400 },
  { left: "4%", top: "64%", delay: 2600 },
  { right: "2%", top: "78%", delay: 700 },
  { left: "1.5%", top: "42%", delay: 3300 },
  { right: "4.5%", top: "8%", delay: 2000 },
];

/**
 * A few slow pixel motifs in the page margins (leaf drift, status blink,
 * cloud drift, floating stars). Decorative only: hidden on narrow screens,
 * with reduced motion, and in the minimal density. Never over content.
 */
export function ThemeAmbient({ theme }: { theme: WorldUiTheme }) {
  if (theme.decorationDensity === "minimal") return null;
  const count = theme.decorationDensity === "decorative" ? 6 : 4;
  return (
    <div aria-hidden className="skin-ambient" data-preset={BASES[theme.baseTheme].motion}>
      {SPOTS.slice(0, count).map(({ delay, ...pos }, i) => (
        <span key={i} style={{ ...pos, animationDelay: `${delay}ms`, backgroundImage: `var(${i % 2 ? "--motif-corner-b" : "--motif-corner-a"})` }} />
      ))}
    </div>
  );
}
