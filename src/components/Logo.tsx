export function Logo({ size = "lg" }: { size?: "sm" | "lg" }) {
  if (size === "sm") {
    return (
      <span className="font-display text-xs leading-none text-paper sm:text-sm" style={{ textShadow: "2px 2px 0 var(--color-twist)" }}>
        PLOT <span className="text-sun">TWIST!</span>
      </span>
    );
  }
  return (
    <h1 className="select-none text-center font-display leading-[1.05]">
      <span
        className="block text-[44px] text-paper sm:text-7xl lg:text-8xl"
        style={{ textShadow: "4px 4px 0 var(--color-twist), 8px 8px 0 var(--color-ink-950)" }}
      >
        PLOT
      </span>
      <span
        className="mt-2 inline-block -rotate-3 text-[44px] text-sun sm:mt-4 sm:text-7xl lg:text-8xl"
        style={{ textShadow: "4px 4px 0 var(--color-twist-dark), 8px 8px 0 var(--color-ink-950)" }}
      >
        TWIST<span className="inline-block rotate-12 text-twist" style={{ textShadow: "4px 4px 0 var(--color-ink-950)" }}>!</span>
      </span>
    </h1>
  );
}
