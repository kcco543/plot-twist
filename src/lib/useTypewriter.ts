"use client";

import { useEffect, useState } from "react";

/** Reveals `text` one character at a time. `skip()` shows it all at once. */
export function useTypewriter(text: string, msPerChar: number) {
  const [state, setState] = useState({ text, count: msPerChar === 0 ? text.length : 0 });
  // Reset when the text changes (derived-state pattern, no effect needed).
  if (state.text !== text) setState({ text, count: msPerChar === 0 ? text.length : 0 });
  const count = state.text === text ? state.count : 0;

  useEffect(() => {
    if (msPerChar === 0 || count >= text.length) return;
    const t = window.setTimeout(() => setState((s) => ({ ...s, count: s.count + 1 })), msPerChar);
    return () => window.clearTimeout(t);
  }, [count, text, msPerChar]);

  return {
    shown: msPerChar === 0 ? text : text.slice(0, count),
    done: msPerChar === 0 || count >= text.length,
    skip: () => setState({ text, count: text.length }),
  };
}
