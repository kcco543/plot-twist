"use client";

import { useEffect, useId, useState } from "react";
import { LoadingDots } from "@/components/ui/LoadingDots";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { RegionSelector } from "@/components/game/RegionSelector";
import { dismissMapEditError, editMapRegion, selectMap, type GeneratedMap, type MapEditJob } from "@/lib/mapGenerator";
import { regionIsUsable, type Region } from "@/lib/mapSelection";
import type { AiErrorCode } from "@/lib/ai/client";
import { useI18n } from "@/i18n";

/**
 * LOCAL MAP EDITING (World Builder preview)
 * --------------------------------------------------------------------------
 * `useRegionEdit` holds the Edit Region state for the page (the preview panel
 * is rendered twice, phone and desktop, so the state lives above both).
 * `MapEditOverlay` goes inside MapStage; `MapEditPanel` goes under it.
 * The edit itself runs in mapGenerator.editMapRegion().
 */
export type RegionEdit = ReturnType<typeof useRegionEdit>;

export function useRegionEdit(map: GeneratedMap | null, opts: { editing: MapEditJob | null; editError: AiErrorCode | null; busy: boolean; available: boolean }) {
  const [active, setActive] = useState(false);
  const [region, setRegion] = useState<Region | null>(null);
  const [instruction, setInstruction] = useState("");
  const mapId = map?.id ?? null;

  // Leave edit mode when there is no generated map to edit (placeholder art, removed map).
  useEffect(() => {
    if (!mapId) setActive(false);
  }, [mapId]);

  const canSubmit = Boolean(map) && opts.available && !opts.busy && regionIsUsable(region) && instruction.trim() !== "";
  const submit = async () => {
    if (!map || !canSubmit || !region) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const ok = await editMapRegion({ mapId: map.id, region, instruction });
    // Keep the box where it is so the same spot can be refined again; clear the words.
    if (ok) setInstruction("");
  };

  return {
    map,
    active,
    region,
    instruction,
    canSubmit,
    available: opts.available,
    busy: opts.busy,
    /** The edit in progress, if it is for this map. */
    pending: opts.editing && opts.editing.mapId === mapId ? opts.editing : null,
    error: opts.editError,
    start: () => setActive(true),
    stop: () => {
      setActive(false);
      setRegion(null);
      dismissMapEditError();
    },
    setRegion,
    setInstruction,
    submit,
  };
}

/** The selection layer over the map image (only while Edit Region is on). */
export function MapEditOverlay({ edit }: { edit: RegionEdit }) {
  const { t } = useI18n();
  if (!edit.active && !edit.pending) return null;
  const region = edit.pending ? edit.pending.region : edit.region;
  return (
    <RegionSelector region={region} onChange={edit.setRegion} disabled={Boolean(edit.pending) || edit.busy} label={t("builder.edit.selectionLabel")}>
      {edit.pending && (
        <span role="status" className="absolute inset-0 grid place-items-center bg-white/35">
          <span className="flex items-center gap-1.5 bg-white/95 px-2 py-1 font-label text-[10px] uppercase text-label shadow-[0_0_0_2px_var(--color-line)]">
            {t("builder.edit.repainting")} <LoadingDots />
          </span>
        </span>
      )}
    </RegionSelector>
  );
}

/** Button to enter Edit Region, and the instruction panel once in it. */
export function MapEditPanel({ edit, versionOf }: { edit: RegionEdit; versionOf: (id: string) => number | null }) {
  const { t, tx } = useI18n();
  const id = useId();
  const { map } = edit;
  if (!map) return null;

  const parent = map.parentId ? versionOf(map.parentId) : null;
  const provenance = map.edit && (
    <p className="flex items-start gap-2 text-sm leading-snug text-ink-soft">
      <PixelIcon name="pencil" size={12} className="mt-1 shrink-0 text-label" />
      <span>{parent ? t("builder.edit.editedFrom", { n: parent, instruction: map.edit.instruction }) : t("builder.edit.editedFromRemoved", { instruction: map.edit.instruction })}</span>
    </p>
  );
  const undo = parent !== null && map.parentId && (
    <PixelButton size="sm" variant="ghost" icon="undo" disabled={Boolean(edit.pending)} onClick={() => selectMap(map.parentId!)}>
      {t("builder.edit.undo")}
    </PixelButton>
  );

  if (!edit.active && !edit.pending) {
    return (
      <div className="flex flex-col gap-2">
        {provenance}
        <div className="flex flex-wrap items-center gap-2">
          <PixelButton size="sm" variant="secondary" icon="pencil" disabled={!edit.available || edit.busy} onClick={edit.start}>
            {t("builder.edit.enter")}
          </PixelButton>
          {undo}
        </div>
      </div>
    );
  }

  const examples = [t("builder.edit.example1"), t("builder.edit.example2"), t("builder.edit.example3")];
  const hasRegion = regionIsUsable(edit.region);

  return (
    <div className="flex flex-col gap-3 bg-well/60 p-3 shadow-[inset_0_0_0_2px_var(--color-line)]">
      <p className="flex items-start gap-2 text-base leading-snug text-ink">
        <PixelIcon name="pencil" size={12} className="mt-1 shrink-0 text-label" />
        <span>{hasRegion ? t("builder.edit.adjustHint") : t("builder.edit.selectHint")}</span>
      </p>

      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={id} className="font-label text-xs uppercase tracking-wide text-label">
            {t("builder.edit.instructionLabel")}
          </label>
          <span className="font-label text-[10px] text-ink-mute tabular-nums" aria-hidden>
            {edit.instruction.length}/300
          </span>
        </div>
        <textarea
          id={id}
          rows={2}
          maxLength={300}
          value={edit.instruction}
          onChange={(e) => edit.setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void edit.submit();
          }}
          placeholder={t("builder.edit.instructionPlaceholder")}
          disabled={Boolean(edit.pending)}
          className="px-input w-full resize-y"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-label text-[10px] uppercase text-ink-mute">{t("builder.edit.examples")}</span>
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={Boolean(edit.pending)}
              onClick={() => edit.setInstruction(ex)}
              className="px-focus bg-white/80 px-1.5 py-0.5 text-left text-sm text-ink-soft shadow-[0_0_0_1px_var(--color-line)] hover:bg-white hover:text-ink disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {edit.error && !edit.pending && (
        <div role="alert" className="flex flex-wrap items-center gap-3 bg-peach-hi px-3 py-2 text-base shadow-[inset_4px_0_0_var(--color-peach-lo)]">
          <span className="min-w-0 flex-1">{t("builder.edit.failed", { reason: tx(`ai.errors.${edit.error}`) })}</span>
          <PixelButton size="sm" variant="ghost" icon="close" onClick={dismissMapEditError} aria-label={t("common.close")} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <PixelButton variant="magic" icon="sparkle" loading={Boolean(edit.pending)} disabled={!edit.canSubmit} onPointerDown={(e) => e.preventDefault()} onClick={() => void edit.submit()}>
          {edit.pending ? t("builder.edit.submitting") : t("builder.edit.submit")}
        </PixelButton>
        <PixelButton size="sm" variant="ghost" icon="eraser" disabled={!edit.region || Boolean(edit.pending)} onClick={() => edit.setRegion(null)}>
          {t("builder.edit.clear")}
        </PixelButton>
        {undo}
        <PixelButton size="sm" variant="ghost" icon="check" disabled={Boolean(edit.pending)} onClick={edit.stop}>
          {t("builder.edit.exit")}
        </PixelButton>
      </div>
      <p className="text-sm leading-snug text-ink-mute">{hasRegion ? t("builder.edit.keepHint") : t("builder.edit.needSelection")}</p>
      {provenance}
    </div>
  );
}
