import type { ArtAsset } from "@/assets/manifest";

/** Renders a replaceable art asset with crisp pixel scaling and an optional PLACEHOLDER tag. */
export function ArtImage({
  art,
  alt,
  className = "",
  showTag = true,
  fit = "cover",
  tagPosition = "bottom",
}: {
  art: ArtAsset;
  alt: string;
  className?: string;
  showTag?: boolean;
  fit?: "cover" | "contain";
  tagPosition?: "top" | "bottom";
}) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- pixel art must not be resampled by next/image */}
      <img
        src={art.src}
        alt={alt}
        width={art.width}
        height={art.height}
        draggable={false}
        className={`pixelated h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"}`}
      />
      {showTag && art.placeholder && (
        <span className={`absolute right-1 ${tagPosition === "top" ? "top-1" : "bottom-1"} bg-ink-950/80 px-1.5 py-0.5 font-display text-[7px] uppercase tracking-wider text-paper-dim`}>
          Placeholder
        </span>
      )}
    </div>
  );
}
