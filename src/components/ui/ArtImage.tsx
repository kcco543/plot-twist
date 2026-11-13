import type { ArtAsset } from "@/assets/manifest";

/**
 * Shows a replaceable pixel-art asset with nearest-neighbor scaling.
 * The box always keeps the art's own aspect ratio, so art is never stretched.
 * Placeholder art gets a small tag so it can't be mistaken for final artwork.
 */
export function ArtImage({
  art,
  alt,
  className = "",
  showTag = true,
  tagLabel = "Placeholder",
  tagPosition = "bottom",
  fit = "contain",
}: {
  art: ArtAsset;
  alt: string;
  className?: string;
  showTag?: boolean;
  tagLabel?: string;
  tagPosition?: "top" | "bottom";
  /** contain = whole image, letterboxed; cover = cropped (never stretched). */
  fit?: "contain" | "cover";
}) {
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ aspectRatio: `${art.width} / ${art.height}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- pixel art must not be resampled by next/image */}
      <img
        src={art.src}
        alt={alt}
        width={art.width}
        height={art.height}
        draggable={false}
        className={`pixelated absolute inset-0 h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"}`}
      />
      {showTag && art.placeholder && (
        <span
          className={`absolute right-1 ${tagPosition === "top" ? "top-1" : "bottom-1"} bg-ink/80 px-1.5 py-0.5 font-label text-[9px] uppercase leading-none text-cream-dim`}
        >
          {tagLabel}
        </span>
      )}
    </div>
  );
}
