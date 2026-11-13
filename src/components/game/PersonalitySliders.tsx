"use client";

import { useId, type CSSProperties } from "react";
import { Panel } from "@/components/ui/Panel";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { detectConflicts } from "@/lib/character/traits";
import { TRAIT_IDS, type Character, type TraitId, type Traits } from "@/lib/types";
import { useI18n } from "@/i18n";

export function useLean() {
  const { tx } = useI18n();
  return (trait: TraitId, v: number) => {
    const low = tx(`traits.${trait}.low`);
    const high = tx(`traits.${trait}.high`);
    if (v <= 15) return tx("sliders.strongly", { pole: low });
    if (v <= 35) return tx("sliders.leans", { pole: low });
    if (v >= 85) return tx("sliders.strongly", { pole: high });
    if (v >= 65) return tx("sliders.leans", { pole: high });
    return tx("sliders.balanced");
  };
}

function TraitSlider({ trait, value, onChange }: { trait: TraitId; value: number | undefined; onChange: (v: number | undefined) => void }) {
  const { t, tx } = useI18n();
  const lean = useLean();
  const id = useId();
  const unset = value === undefined;
  const shown = value ?? 50;
  const low = tx(`traits.${trait}.low`);
  const high = tx(`traits.${trait}.high`);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="font-head text-base font-bold text-ink">
          {low} <span className="text-ink-mute">↔</span> {high}
        </label>
        <span className="flex items-center gap-1.5">
          <span className={`font-label text-[10px] uppercase tabular-nums ${unset ? "text-ink-mute" : "text-label"}`} aria-hidden>
            {unset ? t("sliders.notSet") : `${shown} · ${lean(trait, shown)}`}
          </span>
          {!unset && (
            <button type="button" onClick={() => onChange(undefined)} className="px-focus inline-flex size-8 items-center justify-center text-ink-mute hover:text-coral-deep" aria-label={`${t("sliders.clear")}: ${low} ↔ ${high}`}>
              <PixelIcon name="close" size={9} />
            </button>
          )}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden w-28 shrink-0 text-right text-sm text-ink-soft sm:block" aria-hidden>
          {low}
        </span>
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={1}
          value={shown}
          data-unset={unset}
          aria-valuetext={unset ? t("sliders.notSet") : t("sliders.valueText", { value: shown, lean: lean(trait, shown) })}
          onChange={(e) => onChange(Number(e.target.value))}
          // Clicking an unset slider at its current spot should still "set" it.
          onPointerUp={() => unset && onChange(shown)}
          onKeyUp={(e) => unset && (e.key === "Enter" || e.key === " ") && onChange(shown)}
          className="px-range min-w-0 flex-1"
          style={{ "--fill": `${shown}%` } as CSSProperties}
        />
        <span className="hidden w-28 shrink-0 text-sm text-ink-soft sm:block" aria-hidden>
          {high}
        </span>
      </div>
    </div>
  );
}

export function PersonalitySliders({ character, onChange, onEditText }: { character: Character; onChange: (patch: Partial<Character>) => void; onEditText: (field: "personality") => void }) {
  const { t } = useI18n();
  const setTrait = (trait: TraitId, v: number | undefined) => {
    const next: Traits = { ...character.traits };
    if (v === undefined) delete next[trait];
    else next[trait] = v;
    // Moving a slider re-opens any conflict about it, so the player sees it again.
    onChange({ traits: next, resolvedConflicts: character.resolvedConflicts.filter((id) => !id.startsWith(`${trait}:`)) });
  };
  const count = Object.keys(character.traits).length;
  return (
    <div className="flex flex-col gap-8">
      <ConflictReview character={character} onChange={onChange} onEditText={onEditText} />
      <Panel
        title={t("sliders.title")}
        titleRight={
          count > 0 ? (
            <PixelButton size="sm" variant="ghost" icon="close" onClick={() => onChange({ traits: {}, resolvedConflicts: [] })} className="-mt-1 bg-surface">
              {t("sliders.clearAll")}
            </PixelButton>
          ) : undefined
        }
      >
        <p className="mb-5 max-w-2xl text-base leading-snug text-ink-soft">
          {t("sliders.intro")} <span className="font-label text-[10px] uppercase text-label">{t("sliders.setCount", { count, total: TRAIT_IDS.length })}</span>
        </p>
        <div className="grid gap-x-10 gap-y-5 xl:grid-cols-2">
          {TRAIT_IDS.map((id) => (
            <TraitSlider key={id} trait={id} value={character.traits[id]} onChange={(v) => setTrait(id, v)} />
          ))}
        </div>
      </Panel>
    </div>
  );
}

/** Lists text-vs-slider disagreements. Nothing changes until the player picks an option. */
export function ConflictReview({ character, onChange, onEditText }: { character: Character; onChange: (patch: Partial<Character>) => void; onEditText: (field: "personality") => void }) {
  const { t, tx } = useI18n();
  const lean = useLean();
  const all = detectConflicts(character);
  const open = all.filter((c) => !character.resolvedConflicts.includes(c.id));
  const kept = all.length - open.length;
  if (all.length === 0) return null;
  return (
    <Panel title={t("conflicts.title")} frame={open.length ? "gold" : "panel"}>
      {open.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-base text-ink-soft">
            <PixelIcon name="check" size={12} className="text-mint-deep" /> {t("conflicts.reviewed", { count: kept })}
          </p>
          <PixelButton size="sm" variant="ghost" onClick={() => onChange({ resolvedConflicts: character.resolvedConflicts.filter((id) => !all.some((c) => c.id === id)) })}>
            {t("conflicts.showReviewed")}
          </PixelButton>
        </div>
      ) : (
        <>
          <p className="mb-4 max-w-2xl text-base leading-snug text-ink-soft">{t("conflicts.intro")}</p>
          <ul className="flex flex-col gap-3">
            {open.map((c) => (
              <li key={c.id} className="bg-butter-hi px-3 py-3 shadow-[inset_4px_0_0_var(--color-butter-lo)]">
                <p className="text-base leading-snug text-ink">
                  {t("conflicts.item", {
                    words: c.words.join(", "),
                    trait: `${tx(`traits.${c.trait}.low`)} ↔ ${tx(`traits.${c.trait}.high`)}`,
                    value: c.slider,
                    lean: lean(c.trait, c.slider),
                  })}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <PixelButton size="sm" variant="success" icon="check" onClick={() => onChange({ resolvedConflicts: [...character.resolvedConflicts, c.id] })} title={t("conflicts.keepBothHint")}>
                    {t("conflicts.keepBoth")}
                  </PixelButton>
                  <PixelButton size="sm" variant="calm" onClick={() => onChange({ traits: { ...character.traits, [c.trait]: c.suggested } })}>
                    {t("conflicts.matchSlider", { value: c.suggested })}
                  </PixelButton>
                  <PixelButton size="sm" variant="ghost" icon="pencil" onClick={() => onEditText("personality")}>
                    {t("conflicts.editText")}
                  </PixelButton>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
