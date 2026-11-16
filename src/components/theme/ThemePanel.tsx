"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { PixelButton, buttonStyle } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { gameActions, useSave } from "@/lib/gameStore";
import { suggestTheme } from "@/lib/theme/suggest";
import { APPROVED_ACCENTS, BASES, DENSITIES, MAX_MOTIFS, MOODS, defaultUiTheme, resolveUiTheme, type WorldUiTheme } from "@/lib/theme/themes";
import type { MotifId } from "@/lib/theme/motifs";
import { useI18n } from "@/i18n";
import { Motif } from "./Motif";
import { ThemePreview } from "./ThemePreview";

const same = (a: WorldUiTheme, b: WorldUiTheme) => JSON.stringify({ ...a, updatedAt: 0, confirmed: false }) === JSON.stringify({ ...b, updatedAt: 0, confirmed: false });

/**
 * World Builder → Look & feel. Suggests a mood and motifs from the world
 * description (local keyword rules, no AI call, nothing on every keystroke
 * beyond a string match), previews the skin, and saves it to this world only
 * when the player confirms. The world type stays the base theme; changing
 * the skin never regenerates maps or art.
 */
export function ThemePanel() {
  const { t, tx } = useI18n();
  const save = useSave();
  const saved = resolveUiTheme(save);
  const [draft, setDraft] = useState<WorldUiTheme | null>(saved);
  const savedKey = saved ? JSON.stringify({ ...saved, updatedAt: 0 }) : "";
  // Follow the save when it changes elsewhere (world type switched, another tab).
  useEffect(() => {
    setDraft(savedKey ? (JSON.parse(savedKey) as WorldUiTheme) : null);
  }, [savedKey]);
  const description = save.environment.description;
  const suggestion = useMemo(() => suggestTheme(description, save.worldId), [description, save.worldId]);

  if (!saved || !draft || !save.worldId) return null;
  const base = BASES[draft.baseTheme];
  const worldName = t(`worlds.list.${draft.baseTheme}.name` as const);
  const dirty = !same(draft, saved) || !saved.confirmed;
  const update = (patch: Partial<WorldUiTheme>) => setDraft({ ...draft, ...patch });
  const motifChoices: MotifId[] = [...new Set([...draft.decorativeMotifIds, ...suggestion.motifs, ...base.vocabulary])];
  const toggleMotif = (m: MotifId) => {
    const has = draft.decorativeMotifIds.includes(m);
    if (!has && draft.decorativeMotifIds.length >= MAX_MOTIFS) return;
    update({ decorativeMotifIds: has ? draft.decorativeMotifIds.filter((x) => x !== m) : [...draft.decorativeMotifIds, m] });
  };
  const useSuggestion = () => update({ moodVariant: suggestion.mood, decorativeMotifIds: suggestion.motifs, decorationDensity: "standard" });
  const swatch = (kind: "primary" | "accent", hex: string, i: number) => {
    const current = draft.approvedAccentOverrides[kind] ?? APPROVED_ACCENTS[draft.baseTheme][kind][0];
    const active = current === hex;
    return (
      <button
        key={hex}
        type="button"
        aria-pressed={active}
        aria-label={t("theme.colorOption", { n: i + 1, hex })}
        onClick={() => update({ approvedAccentOverrides: { ...draft.approvedAccentOverrides, [kind]: i === 0 ? undefined : hex } })}
        className={`px-focus size-11 ${active ? "shadow-[0_0_0_3px_var(--color-ink)]" : "shadow-[0_0_0_2px_var(--color-line)]"}`}
        style={{ background: hex }}
      >
        {active && <PixelIcon name="check" size={10} className="mx-auto text-white drop-shadow-[1px_1px_0_rgba(0,0,0,0.5)]" />}
      </button>
    );
  };

  return (
    <Panel title={t("theme.title")}>
      <div className="flex flex-col gap-5" data-theme-panel>
        <p className="text-base leading-snug text-ink-soft">{t("theme.intro", { world: worldName })}</p>

        {/* Suggestion from the description */}
        <div className="flex flex-col gap-2 bg-well px-3 py-2" role="status" aria-live="polite">
          {suggestion.confidence === "none" ? (
            <p className="text-sm text-ink-soft">{t("theme.suggest.none")}</p>
          ) : (
            <>
              <p className="text-base">
                <span className="font-label text-[10px] uppercase text-label">{t("theme.suggest.label")}</span>{" "}
                {t("theme.suggest.summary", { mood: tx(`theme.moods.${suggestion.mood}`), motifs: suggestion.motifs.map((m) => tx(`theme.motifs.${m}`)).join(" · ") || "—" })}
              </p>
              <p className="text-sm text-ink-soft">{t("theme.suggest.because", { words: suggestion.matched.slice(0, 5).join(", ") })}</p>
              {suggestion.baseHint && <p className="text-sm text-ink-soft">{t("theme.suggest.baseHint", { other: tx(`worlds.list.${suggestion.baseHint}.name`), world: worldName })}</p>}
              <div>
                <PixelButton size="sm" variant="magic" icon="sparkle" onClick={useSuggestion}>
                  {t("theme.suggest.use")}
                </PixelButton>
              </div>
            </>
          )}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-label text-xs uppercase tracking-wide text-label">{t("theme.mood")}</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("theme.mood")}>
            {MOODS.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={draft.moodVariant === m} onClick={() => update({ moodVariant: m })} className="px-btn min-h-11 px-2 text-[15px]" style={buttonStyle(draft.moodVariant === m ? "accent" : "ghost")}>
                {tx(`theme.moods.${m}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-label text-xs uppercase tracking-wide text-label">{t("theme.motifsLabel", { n: MAX_MOTIFS })}</legend>
          <div className="flex flex-wrap gap-2">
            {motifChoices.map((m) => {
              const on = draft.decorativeMotifIds.includes(m);
              return (
                <button key={m} type="button" aria-pressed={on} disabled={!on && draft.decorativeMotifIds.length >= MAX_MOTIFS} onClick={() => toggleMotif(m)} className="px-btn min-h-11 px-2 text-[15px]" style={buttonStyle(on ? "accent" : "ghost")}>
                  <Motif id={m} size={12} />
                  {tx(`theme.motifs.${m}`)}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="font-label text-xs uppercase tracking-wide text-label">{t("theme.primary")}</p>
            <div className="flex flex-wrap gap-2">{APPROVED_ACCENTS[draft.baseTheme].primary.map((h, i) => swatch("primary", h, i))}</div>
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-label text-xs uppercase tracking-wide text-label">{t("theme.accent")}</p>
            <div className="flex flex-wrap gap-2">{APPROVED_ACCENTS[draft.baseTheme].accent.map((h, i) => swatch("accent", h, i))}</div>
          </div>
        </div>
        <p className="-mt-2 text-sm text-ink-mute">{t("theme.colorsNote")}</p>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-label text-xs uppercase tracking-wide text-label">{t("theme.density")}</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("theme.density")}>
            {DENSITIES.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={draft.decorationDensity === d} onClick={() => update({ decorationDensity: d })} className="px-btn min-h-11 px-2 text-[15px]" style={buttonStyle(draft.decorationDensity === d ? "accent" : "ghost")}>
                {tx(`theme.densities.${d}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <ThemePreview theme={draft} label={t("theme.preview.label", { world: worldName })} />

        <div className="flex flex-wrap items-center gap-3">
          <PixelButton variant="primary" icon="check" disabled={!dirty} onClick={() => gameActions.setUiTheme({ ...draft, confirmed: true })}>
            {t("theme.confirm")}
          </PixelButton>
          <PixelButton variant="ghost" icon="undo" onClick={() => { gameActions.setUiTheme(null); setDraft(defaultUiTheme(draft.baseTheme)); }}>
            {t("theme.restore")}
          </PixelButton>
          <span className="text-sm text-ink-soft" role="status">
            {!dirty ? t("theme.saved") : saved.confirmed ? t("theme.unsaved") : t("theme.defaultInUse")}
          </span>
        </div>
        <p className="text-sm text-ink-mute">{t("theme.mapNote")}</p>
      </div>
    </Panel>
  );
}
