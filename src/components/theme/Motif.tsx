import { MOTIFS, type MotifId } from "@/lib/theme/motifs";

/** A world motif glyph in currentColor (same 7×7 grid as PixelIcon). Decorative only. */
export function Motif({ id, size = 14, className = "" }: { id: MotifId; size?: number; className?: string }) {
  const rows = MOTIFS[id];
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 7 7" shapeRendering="crispEdges" className={`inline-block shrink-0 ${className}`}>
      {rows.flatMap((r, y) => [...r].map((c, x) => (c === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" /> : null)))}
    </svg>
  );
}
