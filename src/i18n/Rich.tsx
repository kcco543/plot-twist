import { Fragment, type ReactNode } from "react";

/** Fills {placeholders} in a translated template with React nodes (e.g. a colored world name). */
export function Rich({ template, values }: { template: string; values: Record<string, ReactNode> }) {
  const parts = template.split(/(\{\w+\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\{(\w+)\}$/);
        return <Fragment key={i}>{m && m[1] in values ? values[m[1]] : p}</Fragment>;
      })}
    </>
  );
}
