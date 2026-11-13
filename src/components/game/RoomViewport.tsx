import type { CSSProperties, ReactNode } from "react";
import { ArtImage } from "@/components/ui/ArtImage";
import type { ArtAsset } from "@/assets/manifest";

/** A framed, fixed-aspect game screen. Used by the World Builder preview and Play Mode. */
export function RoomViewport({
  art,
  label,
  accent = "var(--color-paper)",
  children,
  className = "",
}: {
  art: ArtAsset;
  label: string;
  accent?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`px-frame bg-ink-950 p-1 ${className}`} style={{ "--frame": accent } as CSSProperties}>
      <div className="relative aspect-[8/5] w-full overflow-hidden">
        <ArtImage art={art} alt={label} className="absolute inset-0" tagPosition="top" />
        {children}
      </div>
    </div>
  );
}
