"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { delayBefore, splitGraphemes } from "./dialogue/typewriter";

/**
 * Reveals `text` one grapheme cluster at a time (safe for Chinese, emoji and
 * accents). There is only ever ONE pending timer: each step schedules the next
 * from an effect whose cleanup cancels it, so changing the line, the speed or
 * pausing can never double up characters.
 *
 * - `id` identifies the line. A new id restarts the animation. If only the
 *   text changes (e.g. the language was switched) a finished line stays finished.
 * - `paused` holds the animation where it is (menus open, etc.).
 * - `msPerChar` 0 = instant. The speed can change mid-line.
 */
export function useTypewriter(text: string, msPerChar: number, opts: { id?: string | number; paused?: boolean } = {}) {
  const id = String(opts.id ?? "");
  const paused = Boolean(opts.paused);
  const graphemes = useMemo(() => splitGraphemes(text), [text]);
  const total = graphemes.length;
  const instant = msPerChar <= 0;

  const [state, setState] = useState({ id, text, count: instant ? total : 0 });
  // Derived-state reset (no effect, so the old line never flashes).
  let count = state.count;
  if (state.id !== id || state.text !== text) {
    const keepDone = state.id === id && state.count >= splitGraphemes(state.text).length;
    count = instant || keepDone ? total : 0;
    setState({ id, text, count });
  } else if (instant && count < total) {
    count = total;
    setState({ id, text, count });
  }
  count = Math.min(count, total);
  const done = count >= total;

  useEffect(() => {
    if (done || paused || instant) return;
    const timer = window.setTimeout(
      () =>
        // Only advance the line this timer was scheduled for.
        setState((s) => (s.id === id && s.text === text ? { ...s, count: Math.min(total, s.count + 1) } : s)),
      delayBefore(graphemes, count, msPerChar),
    );
    return () => window.clearTimeout(timer);
  }, [count, done, paused, instant, id, text, total, graphemes, msPerChar]);

  const skip = useCallback(() => setState({ id, text, count: total }), [id, text, total]);
  const restart = useCallback(() => setState({ id, text, count: 0 }), [id, text]);

  const shown = done ? text : graphemes.slice(0, count).join("");
  const rest = done ? "" : graphemes.slice(count).join("");
  return useMemo(
    () => ({
      /** Revealed part. */
      shown,
      /** Not-yet-revealed part (render it invisibly so line wrapping never jumps). */
      rest,
      done,
      progress: total === 0 ? 1 : count / total,
      skip,
      restart,
    }),
    [shown, rest, done, total, count, skip, restart],
  );
}

export type Typewriter = ReturnType<typeof useTypewriter>;
