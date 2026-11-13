import { ArtImage } from "@/components/ui/ArtImage";
import { PixelButton } from "@/components/ui/PixelButton";
import { characterArt, getCharacterArt } from "@/assets/manifest";

/**
 * Portrait area. Today it cycles through placeholder portraits.
 * Future: a pixel editor or AI portrait generator can render inside this frame
 * and store its result on the character instead of an index.
 */
export function PortraitSlot({ index, name, onChange }: { index: number; name: string; onChange: (i: number) => void }) {
  const total = characterArt.length;
  const shown = ((index % total) + total) % total;
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="px-frame px-checker w-40 p-2 sm:w-48" style={{ "--frame": "var(--color-sun)" } as React.CSSProperties}>
        <ArtImage art={getCharacterArt(index).portrait} alt={`Portrait of ${name || "unnamed character"}`} className="aspect-square" />
      </div>
      <div className="flex items-center gap-3">
        <PixelButton size="sm" variant="ghost" icon="left" aria-label="Previous portrait" onClick={() => onChange(shown - 1)} />
        <span className="min-w-14 text-center font-display text-[9px] uppercase text-paper-dim" aria-live="polite">
          {shown + 1}/{total}
        </span>
        <PixelButton size="sm" variant="ghost" icon="right" aria-label="Next portrait" onClick={() => onChange(shown + 1)} />
      </div>
      <p className="max-w-48 text-center text-sm leading-snug text-ink-400">Placeholder portraits. A pixel editor and AI portraits will plug into this slot later.</p>
    </div>
  );
}
