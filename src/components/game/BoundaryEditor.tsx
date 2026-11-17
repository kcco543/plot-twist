"use client";

import { Panel } from "@/components/ui/Panel";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { Field } from "@/components/ui/Field";
import { useI18n } from "@/i18n";
import { makeId } from "@/lib/id";
import { BOUNDARY_KINDS, type BoundaryKind, type Character, type CharacterBoundary } from "@/lib/types";

/** At most this many written boundaries per character. */
export const BOUNDARY_MAX = 8;

/**
 * Character Studio: personal boundaries. HARD boundaries never change in
 * play (only here); SOFT ones may be reconsidered for one person after
 * meaningful experiences. Editing here is the explicit, authorized way to
 * change either.
 */
export function BoundaryEditor({ character, onChange }: { character: Character; onChange: (patch: Partial<Character>) => void }) {
  const { t, tx } = useI18n();
  const list = character.boundaries ?? [];
  const set = (next: CharacterBoundary[]) => onChange({ boundaries: next });
  const patch = (id: string, p: Partial<CharacterBoundary>) => set(list.map((b) => (b.id === id ? { ...b, ...p } : b)));
  const add = (strength: CharacterBoundary["strength"]) => set([...list, { id: makeId("bd"), strength, kind: "secret", text: "", topics: "" }]);

  return (
    <Panel title={t("studio.boundaries.title")}>
      <div className="flex flex-col gap-4" data-boundaries>
        <p className="text-base leading-snug text-ink-soft">{t("studio.boundaries.intro")}</p>
        <ul className="grid gap-2 text-sm text-ink-soft sm:grid-cols-2">
          <li className="flex gap-2">
            <PixelIcon name="lock" size={12} className="mt-1 shrink-0 text-label" />
            <span>{t("studio.boundaries.hardHelp")}</span>
          </li>
          <li className="flex gap-2">
            <PixelIcon name="unlock" size={12} className="mt-1 shrink-0 text-label" />
            <span>{t("studio.boundaries.softHelp")}</span>
          </li>
        </ul>
        {list.length === 0 && <p className="text-sm text-ink-mute">{t("studio.boundaries.empty")}</p>}
        {list.map((b, i) => (
          <div key={b.id} className="flex flex-col gap-3 border-2 border-dashed border-line p-3" data-boundary={b.strength}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-label text-xs uppercase tracking-wide text-label">{t("studio.boundaries.item", { n: i + 1 })}</span>
              <div role="radiogroup" aria-label={t("studio.boundaries.strength")} className="flex gap-1">
                {(["hard", "soft"] as const).map((s) => (
                  <button
                    key={s}
                    role="radio"
                    aria-checked={b.strength === s}
                    onClick={() => patch(b.id, { strength: s })}
                    className={`px-focus inline-flex min-h-9 items-center gap-1 px-2 font-label text-[11px] uppercase ${b.strength === s ? "bg-butter-hi text-label shadow-[inset_0_0_0_2px_var(--color-butter-lo)]" : "text-ink-mute hover:text-label"}`}
                  >
                    <PixelIcon name={s === "hard" ? "lock" : "unlock"} size={11} />
                    {t(`studio.boundaries.${s}`)}
                  </button>
                ))}
              </div>
              <label className="ml-auto flex items-center gap-2 font-label text-[11px] uppercase text-label">
                {t("studio.boundaries.kind")}
                <select className="px-input min-h-9 py-1 text-sm normal-case" value={b.kind} onChange={(e) => patch(b.id, { kind: e.target.value as BoundaryKind })}>
                  {BOUNDARY_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {tx(`studio.boundaries.kinds.${k}`)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => set(list.filter((x) => x.id !== b.id))}
                aria-label={t("studio.boundaries.remove")}
                title={t("studio.boundaries.remove")}
                className="px-focus inline-flex min-h-9 min-w-9 items-center justify-center text-ink-mute hover:text-label"
              >
                <PixelIcon name="trash" size={12} />
              </button>
            </div>
            <Field label={t("studio.boundaries.text")} placeholder={tx(`studio.boundaries.textPlaceholder.${b.kind}`)} value={b.text} maxLength={160} onChange={(v) => patch(b.id, { text: v })} />
            <Field label={t("studio.boundaries.topics")} hint={t("studio.boundaries.topicsHint")} placeholder={t("studio.boundaries.topicsPlaceholder")} value={b.topics} maxLength={200} onChange={(v) => patch(b.id, { topics: v })} />
          </div>
        ))}
        {list.length < BOUNDARY_MAX && (
          <div className="flex flex-wrap gap-2">
            <PixelButton size="sm" variant="calm" icon="lock" onClick={() => add("hard")} data-add-boundary="hard">
              {t("studio.boundaries.addHard")}
            </PixelButton>
            <PixelButton size="sm" variant="ghost" icon="unlock" onClick={() => add("soft")} data-add-boundary="soft">
              {t("studio.boundaries.addSoft")}
            </PixelButton>
          </div>
        )}
      </div>
    </Panel>
  );
}
