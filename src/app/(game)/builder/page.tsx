"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionBar, ScreenHeader } from "@/components/ScreenHeader";
import { MapEditOverlay, MapEditPanel, useRegionEdit } from "@/components/game/MapEditPanel";
import { MapStage } from "@/components/game/MapStage";
import { PixelStage } from "@/components/game/PixelStage";
import { ArtImage } from "@/components/ui/ArtImage";
import { Field } from "@/components/ui/Field";
import { LoadingDots } from "@/components/ui/LoadingDots";
import { Panel } from "@/components/ui/Panel";
import { PixelButton, PixelLink, buttonStyle } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { ThemePanel } from "@/components/theme/ThemePanel";
import { defaultWorld, environmentArt } from "@/assets/manifest";
import { ENVIRONMENT_TYPES } from "@/lib/environments";
import type { EnvironmentTypeId } from "@/lib/types";
import { gameActions, useSave } from "@/lib/gameStore";
import { useAiStatus } from "@/lib/ai/client";
import { currentMap, dismissMapError, generateMap, makePixelGridCopy, mapIsOutdated, placeholderArt, removeMap, selectMap, useMapStudio } from "@/lib/mapGenerator";
import { isNativeSize } from "@/lib/pixelArt/mapPixels";
import { getWorld } from "@/lib/worlds";
import { useI18n } from "@/i18n";
import { SceneEditor } from "@/components/game/SceneEditor";
import { mapDisplayName } from "@/lib/scene/useScene";
import { readLayout } from "@/lib/scene/layout";

/** Where each environment thumbnail crops to (the scene's most readable spot). */
const THUMB_FOCUS: Record<EnvironmentTypeId, string> = {
  interior: "50% 62%",
  street: "48% 66%",
  wilderness: "62% 30%",
  ruins: "50% 58%",
  dreamscape: "74% 14%",
};

export default function WorldBuilderPage() {
  const { t, tx } = useI18n();
  const router = useRouter();
  const save = useSave();
  const status = useAiStatus();
  const phonePreviewRef = useRef<HTMLDivElement>(null);
  const studio = useMapStudio();
  const [areaOpen, setAreaOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertFailed, setConvertFailed] = useState(false);
  const world = getWorld(save.worldId);
  const { description, type } = save.environment;
  const worldName = world ? t(`worlds.list.${world.id}.name` as const) : "";
  const envName = t(`environments.${type}.name` as const);
  const title = world ? `${worldName} · ${envName}` : envName;

  const request = { worldId: save.worldId, type, description };
  const map = currentMap(studio.maps, save.environment.mapId);
  const working = studio.working !== null;
  /** A full map or a region edit is being drawn: only one at a time. */
  const busy = working || studio.editing !== null;
  const outdated = map !== null && description.trim() !== "" && mapIsOutdated(map, request);
  const canGenerate = Boolean(status?.image) && description.trim() !== "" && !busy;
  const edit = useRegionEdit(map, { editing: studio.editing, editError: studio.editError, busy, available: Boolean(status?.image) });
  const generate = () => {
    // Close the phone keyboard so the preview (and its loading state) is in view.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    void generateMap(request);
    // On phones the preview sits below the fold: bring it into view so the progress is visible.
    const phonePreview = phonePreviewRef.current;
    if (phonePreview?.offsetParent) phonePreview.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // On phones the action bar reappears when the description loses focus and could land on top of
  // the button mid-tap, swallowing the click. Keep focus until the click itself runs.
  const keepFocus = (e: React.PointerEvent) => e.preventDefault();
  const versionOf = (id: string) => studio.maps.length - studio.maps.findIndex((m) => m.id === id);
  const versionIfKept = (id: string) => (studio.maps.some((m) => m.id === id) ? versionOf(id) : null);

  const drawing = working && (
    <div role="status" className="absolute inset-0 grid place-items-center bg-surface/40">
      <span className="flex flex-col items-center gap-1 bg-white/95 px-3 py-2 text-center shadow-[0_0_0_2px_var(--color-line)]">
        <span className="flex items-center gap-2 font-label text-xs uppercase text-label">
          {t("builder.map.drawing")} <LoadingDots />
        </span>
        <span className="text-sm text-ink-soft">
          {t("builder.map.drawingHint")}
          {map && ` ${t("builder.map.keepHint")}`}
        </span>
      </span>
    </div>
  );

  const previewPanel = (
    <Panel
      sparkles
      title={t("builder.preview")}
      titleRight={
        <span className="mt-1 bg-well px-1.5 py-1 font-label text-[10px] uppercase text-ink-soft">
          {!studio.loaded ? <LoadingDots /> : working && map ? t("builder.map.showingWhileDrawing", { n: versionOf(map.id) }) : map ? t("builder.map.version", { n: versionOf(map.id) }) : t("builder.sampleTag")}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {map ? (
          <MapStage src={map.url} width={map.width} height={map.height} label={t("builder.previewAlt", { title })} frame={world?.frame ?? "card"}>
            <MapEditOverlay edit={edit} />
            {drawing}
          </MapStage>
        ) : (
          <div className="relative">
            <PixelStage art={placeholderArt(save.worldId, type)} label={t("builder.previewAlt", { title })} frame={world?.frame ?? "card"}>
              <span className="absolute left-1 top-1 bg-white/90 px-1 py-[1px] font-label text-[6px] uppercase leading-none text-ink">{title}</span>
            </PixelStage>
            {drawing}
            {/* Never let the built-in art pass for a map made from the player's words. */}
            <p data-sample-notice className="mt-2 flex items-start gap-2 bg-well px-3 py-2 text-sm leading-snug text-ink-soft shadow-[inset_4px_0_0_var(--color-line)]">
              <PixelIcon name="image" size={12} className="mt-0.5 shrink-0 text-label" />
              {t("builder.sampleNotice", { place: envName })}
            </p>
          </div>
        )}

        {outdated && !working && (
          <p className="flex items-start gap-2 bg-butter-hi px-3 py-2 text-base leading-snug shadow-[inset_4px_0_0_var(--color-butter-lo)]">
            <PixelIcon name="pencil" size={12} className="mt-1 shrink-0 text-label" />
            {t("builder.map.outdated")}
          </p>
        )}

        <MapEditPanel edit={edit} versionOf={versionIfKept} />

        {/* The map shown here is the one Play uses (the world save's selected map). */}
        {map && !working && (
          <div data-play-map className="flex flex-wrap items-center gap-2 bg-mint-hi px-3 py-2 shadow-[inset_4px_0_0_var(--color-mint-deep)]">
            <PixelIcon name="check" size={12} className="shrink-0 text-mint-deep" />
            <span className="min-w-0 flex-1 text-base leading-snug">
              <span className="font-bold">
                {t("playArea.inPlay")}: {mapDisplayName(map) || t("playArea.untitled")}
              </span>
              <span className="block text-sm text-ink-soft">{t("playArea.builderHint")}</span>
            </span>
            <PixelButton size="sm" variant={readLayout(map.scene, map.width, map.height).reviewed ? "ghost" : "calm"} icon="pencil" disabled={busy} onClick={() => setAreaOpen(true)} data-edit-play-area>
              {t("playArea.title")}
            </PixelButton>
          </div>
        )}

        <p className="min-h-12 text-lg leading-snug text-ink-soft">
          {map ? `“${map.description}”` : description.trim() ? t("builder.notDrawnYet", { text: description.trim() }) : t("builder.quoteEmpty")}
        </p>

        {studio.maps.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-label text-xs uppercase tracking-wide text-label">{t("builder.map.history")}</span>
              <span className="flex flex-wrap gap-2">
                {map && (
                  <a
                    href={map.url}
                    download={`plot-twist-map-v${versionOf(map.id)}.${map.ext}`}
                    className="px-btn min-h-11 px-1.5 text-[15px]"
                    style={buttonStyle("ghost")}
                  >
                    <PixelIcon name="down" size={12} />
                    <span>{t("builder.map.download")}</span>
                  </a>
                )}
                {map && !isNativeSize(map.width) && (
                  <PixelButton
                    size="sm"
                    variant="calm"
                    icon="layers"
                    disabled={busy || converting}
                    loading={converting}
                    title={t("builder.map.pixelGridCopyHint")}
                    onClick={async () => {
                      setConverting(true);
                      setConvertFailed(!(await makePixelGridCopy(map.id)));
                      setConverting(false);
                    }}
                    data-pixel-grid-copy
                  >
                    {t("builder.map.pixelGridCopy")}
                  </PixelButton>
                )}
                {map && (
                  <PixelButton size="sm" variant="ghost" icon="trash" disabled={busy} onClick={() => void removeMap(map.id)}>
                    {t("builder.map.remove")}
                  </PixelButton>
                )}
                {map && (
                  <PixelButton size="sm" variant="ghost" icon="image" onClick={() => selectMap(null)}>
                    {t("builder.map.usePlaceholder")}
                  </PixelButton>
                )}
              </span>
            </div>
            {map && !isNativeSize(map.width) && <p className="text-sm text-ink-mute">{t("builder.map.pixelGridCopyHint")}</p>}
            {convertFailed && <p className="text-sm text-coral-deep">{t("builder.map.pixelGridFailed")}</p>}
            <ul className="flex gap-2 overflow-x-auto pb-1" aria-label={t("builder.map.history")}>
              {studio.maps.map((m) => {
                const active = m.id === map?.id;
                const n = versionOf(m.id);
                return (
                  <li key={m.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => selectMap(m.id)}
                      aria-pressed={active}
                      title={m.edit ? m.edit.instruction : m.description}
                      aria-label={t("builder.map.showVersion", { n })}
                      className={`px-focus relative block w-24 sm:w-28 ${active ? "shadow-[0_0_0_3px_var(--color-butter-lo)]" : "opacity-80 shadow-[0_0_0_2px_var(--color-line)] hover:opacity-100"}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.url} alt="" className={`${isNativeSize(m.width) ? "pixelated " : ""}block w-full object-cover`} style={{ aspectRatio: `${m.width} / ${m.height}` }} />
                      <span className="absolute bottom-0.5 left-0.5 flex items-center gap-0.5 bg-white/90 px-1 font-label text-[9px] uppercase leading-tight text-ink">
                        v{n}
                        {m.parentId && (
                          <span title={t("builder.edit.editedTag")}>
                            <PixelIcon name="pencil" size={8} className="text-label" />
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );

  return (
    <>
      <main className="content-grid flex-1 pt-8 sm:pt-10">
        <ScreenHeader kicker={t("builder.kicker")} title={t("builder.heading")}>
          {t("builder.intro")}
        </ScreenHeader>

        <div className="grid layout-gap lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="flex min-w-0 flex-col gap-8">
            <Panel title={t("builder.description")}>
              <Field
                label={t("builder.describeLabel")}
                multiline
                rows={5}
                maxLength={600}
                value={description}
                onChange={(v) => gameActions.updateEnvironment({ description: v })}
                placeholder={t("builder.describePlaceholder")}
                hint={t("builder.describeHint")}
              />
              <div className="mt-4 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <PixelButton variant="magic" icon="sparkle" loading={working} disabled={!canGenerate} onPointerDown={keepFocus} onClick={generate}>
                    {working ? t("builder.map.generating") : t("builder.map.generate")}
                  </PixelButton>
                  {map && !working && <span className="text-sm text-ink-mute">{t("builder.map.iterateHint")}</span>}
                </div>
                {status && !status.image && (
                  <p className="flex items-start gap-2 text-sm leading-snug text-ink-soft" role="note">
                    <PixelIcon name="offline" size={12} className="mt-1 shrink-0 text-coral-deep" />
                    <span>
                      <span className="font-bold text-ink">{t("builder.map.unavailable")}.</span> {t("builder.map.unavailableHint")}
                    </span>
                  </p>
                )}
                {status?.image && !description.trim() && <p className="text-sm text-ink-mute">{t("builder.map.needDescription")}</p>}
                {studio.error && !working && (
                  <div role="alert" className="flex flex-wrap items-center gap-3 bg-peach-hi px-3 py-2 text-base shadow-[inset_4px_0_0_var(--color-peach-lo)]">
                    <span className="min-w-0 flex-1">{t("builder.map.failed", { reason: tx(`ai.errors.${studio.error}`) })}</span>
                    {canGenerate && (
                      <PixelButton size="sm" variant="ghost" icon="undo" onClick={generate}>
                        {t("common.retry")}
                      </PixelButton>
                    )}
                    <PixelButton size="sm" variant="ghost" icon="close" onClick={dismissMapError} aria-label={t("common.close")} />
                  </div>
                )}
              </div>
            </Panel>

            {/* On phones the preview sits right under the description, before the type picker. */}
            <div ref={phonePreviewRef} className="scroll-mt-24 lg:hidden">{previewPanel}</div>

            <Panel title={t("builder.type")}>
              <div role="radiogroup" aria-label={t("builder.type")} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                {ENVIRONMENT_TYPES.map((env) => {
                  const active = env === type;
                  return (
                    <button
                      key={env}
                      role="radio"
                      aria-checked={active}
                      title={t(`environments.${env}.hint` as const)}
                      onClick={() => gameActions.updateEnvironment({ type: env })}
                      className={`px-frame px-focus relative flex flex-col text-left ${active ? "px-selected" : "px-lift"}`}
                      style={{ "--frame": `var(--frame-${active ? "gold-card" : "card"})` } as React.CSSProperties}
                    >
                      <div className="relative">
                        <ArtImage art={environmentArt[save.worldId ?? defaultWorld][env]} alt="" showTag={false} fit="native" focus={THUMB_FOCUS[env]} className="w-full border-2 border-outline/40" />
                        {active && (
                          <span className="absolute right-1 top-1 grid size-5 animate-pop place-items-center bg-butter text-ink shadow-[1px_1px_0_var(--color-butter-lo)]">
                            <PixelIcon name="check" size={9} />
                          </span>
                        )}
                      </div>
                      <span className={`pt-2 font-head text-base font-bold leading-tight ${active ? "text-label" : "text-ink"}`}>{t(`environments.${env}.name` as const)}</span>
                      <span className="text-sm leading-snug text-ink-soft">{t(`environments.${env}.hint` as const)}</span>
                    </button>
                  );
                })}
              </div>
            </Panel>

            <ThemePanel />
          </div>

          <div className="sticky-col hidden min-w-0 lg:block">{previewPanel}</div>
        </div>
      </main>

      {/* One editor for both preview panels (phone and desktop layouts). */}
      {map && <SceneEditor open={areaOpen} map={map} onClose={() => setAreaOpen(false)} />}

      <ActionBar>
        <PixelLink href="/studio" variant="ghost" icon="left">
          {t("builder.backToCast")}
        </PixelLink>
        <PixelButton variant="primary" icon="play" onClick={() => router.push("/play")}>
          {t("builder.play")}
        </PixelButton>
      </ActionBar>
    </>
  );
}
