import type { CSSProperties } from "react";

/**
 * Tiny pixel decorations. Purely ornamental: every one is aria-hidden and
 * inherits currentColor, so a parent's text color tints it.
 */

const SPARKLE = ["..#..", "..#..", "##.##", "..#..", "..#.."];
const DIAMOND = ["..#..", ".###.", "#####", ".###.", "..#.."];
const DOT = ["##", "##"];

function Grid({ rows, size, className = "", style }: { rows: string[]; size: number; className?: string; style?: CSSProperties }) {
  const w = rows[0].length;
  const h = rows.length;
  return (
    <svg
      aria-hidden
      width={size}
      height={(size * h) / w}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      className={`inline-block shrink-0 ${className}`}
      style={style}
    >
      {rows.flatMap((r, y) => [...r].map((c, x) => (c === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" /> : null)))}
    </svg>
  );
}

/** Four-point pixel sparkle. `twinkle` animates it (respects reduced motion). */
export function Sparkle({ size = 10, twinkle = false, className = "", delay = 0 }: { size?: number; twinkle?: boolean; className?: string; delay?: number }) {
  return <Grid rows={SPARKLE} size={size} className={`${twinkle ? "animate-twinkle" : ""} ${className}`} style={delay ? { animationDelay: `${delay}ms` } : undefined} />;
}

export function Gem({ size = 8, className = "" }: { size?: number; className?: string }) {
  return <Grid rows={DIAMOND} size={size} className={className} />;
}

/** A short dotted pixel rule with a gem in the middle; used under headings. */
export function PixelDivider({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`flex items-center gap-1.5 ${className}`}>
      <span className="text-pink"><Grid rows={DOT} size={4} /></span>
      <span className="text-peach"><Grid rows={DOT} size={4} /></span>
      <span className="text-butter-lo"><Gem size={10} /></span>
      <span className="text-mint"><Grid rows={DOT} size={4} /></span>
      <span className="text-periwinkle"><Grid rows={DOT} size={4} /></span>
    </span>
  );
}

/** Sparkles tucked into a framed surface's corners. Parent must be `relative`. */
export function CornerSparkles({ tone = "text-butter-lo" }: { tone?: string }) {
  return (
    <span aria-hidden className={`pointer-events-none absolute inset-0 ${tone}`}>
      <Sparkle size={10} twinkle className="absolute -right-1.5 -top-1.5" />
      <Sparkle size={7} twinkle delay={900} className="absolute -bottom-1 -left-1 text-pink" />
    </span>
  );
}
