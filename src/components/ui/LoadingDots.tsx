/** Stepped "..." loader. Pair with visible or sr-only text. */
export function LoadingDots({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`inline-flex gap-[3px] animate-dots ${className}`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className="block size-[5px] bg-current" />
      ))}
    </span>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center justify-center gap-3 py-16 font-label text-xs uppercase text-cream-dim">
      {label}
      <LoadingDots className="text-butter" />
    </p>
  );
}
