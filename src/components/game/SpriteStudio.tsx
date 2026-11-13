"use client";

import { useEffect, useRef, useState } from "react";
import { ArtImage } from "@/components/ui/ArtImage";
import { Toggle } from "@/components/ui/Choice";
import { LoadingDots } from "@/components/ui/LoadingDots";
import { Panel } from "@/components/ui/Panel";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { PixelEditor } from "./PixelEditor";
import { defaultWorld, environmentArt } from "@/assets/manifest";
import { AiRequestError, requestSprite, useAiStatus } from "@/lib/ai/client";
import { artFor } from "@/lib/character/art";
import { gameActions, useSave } from "@/lib/gameStore";
import { checkFile, convertToGameArt, imgToDataURL, prepareUpload } from "@/lib/sprites/canvas";
import { checkSprite, DEFAULT_CONVERT, type ConvertOptions, type Img } from "@/lib/sprites/pixelize";
import type { Character, SpriteSource } from "@/lib/types";
import { useI18n } from "@/i18n";

type Source = { url: string; kind: "ai" | "converted" };
type Result = { sprite: string; portrait: string; spriteImg: Img };

/** Sprite preview standing in the current world's scene, so the player sees it at game scale. */
function StagePreview({ sprite, label }: { sprite: string; label: string }) {
  const save = useSave();
  const env = environmentArt[save.worldId ?? defaultWorld][save.environment.type];
  return (
    <figure className="flex flex-col gap-1.5">
      <div className="relative w-full max-w-[320px] overflow-hidden shadow-[0_0_0_3px_var(--color-line)]" style={{ aspectRatio: "320 / 192" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={env.src} alt="" className="pixelated absolute inset-0 size-full" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={sprite} alt="" className="pixelated absolute" style={{ width: "10%", left: "45%", top: `${((176 - 32) / 192) * 100}%` }} />
      </div>
      <figcaption className="font-label text-[10px] uppercase text-ink-soft">{label}</figcaption>
    </figure>
  );
}

export function SpriteStudio({ character }: { character: Character }) {
  const { t, tx } = useI18n();
  const save = useSave();
  const status = useAiStatus();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [refUrl, setRefUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [permission, setPermission] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [options, setOptions] = useState<ConvertOptions>(DEFAULT_CONVERT);
  const [result, setResult] = useState<Result | null>(null);
  const [nothing, setNothing] = useState(false);
  const [edited, setEdited] = useState<Result | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const current = artFor(character);

  // The reference preview uses an object URL that only lives in this tab; it's never stored.
  useEffect(() => () => void (refUrl && URL.revokeObjectURL(refUrl)), [refUrl]);

  // Re-run the pixel conversion when the source or the options change.
  useEffect(() => {
    if (!source) return;
    let live = true;
    convertToGameArt(source.url, options)
      .then((r) => {
        if (!live) return;
        setResult(r);
        setNothing(!r);
        setEdited(null);
      })
      .catch(() => live && setNothing(true));
    return () => {
      live = false;
    };
  }, [source, options]);

  const pick = (f: File | undefined) => {
    setFileError(null);
    setSavedMsg(null);
    if (!f) return;
    const problem = checkFile(f);
    if (problem) {
      setFileError(t(`sprite.fileErrors.${problem}`));
      return;
    }
    setFile(f);
    setRefUrl(URL.createObjectURL(f));
    setSource(null);
    setResult(null);
    setError(null);
  };

  const generate = async () => {
    if (!file) return;
    setGenerating(true);
    setError(null);
    setSavedMsg(null);
    try {
      const blob = await prepareUpload(file);
      const out = await requestSprite(blob, { appearance: character.appearance, world: save.worldId });
      setSource({ url: out.image, kind: "ai" });
    } catch (e) {
      setError(tx(`ai.errors.${e instanceof AiRequestError ? e.code : "failed"}`));
    } finally {
      setGenerating(false);
    }
  };

  const convert = () => {
    if (!refUrl) return;
    setSavedMsg(null);
    setSource({ url: refUrl, kind: "converted" });
  };

  const shown = edited ?? result;
  const spec = shown ? checkSprite(shown.spriteImg) : null;
  const sourceKind: SpriteSource = edited ? "edited" : (source?.kind ?? "converted");
  const name = character.name.trim() || t("common.unnamed");

  const saveResult = () => {
    if (!shown) return;
    gameActions.saveSprite({ sprite: shown.sprite, portrait: shown.portrait, source: sourceKind }, name, character.id);
    setSavedMsg(t("sprite.saved", { name }));
  };

  return (
    <div className="flex flex-col gap-8">
      <Panel title={t("sprite.title")} sparkles>
        <p className="max-w-2xl text-base leading-snug text-ink-soft">{t("sprite.intro")}</p>
        <p className="mt-1 flex items-center gap-2 text-sm text-ink-mute">
          <PixelIcon name="user" size={10} /> {t("sprite.standingOnly")}
        </p>

        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* 1 · Upload + preview */}
          <div className="flex min-w-0 flex-col gap-3">
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} aria-label={t("sprite.upload")} />
            <div className="flex flex-wrap items-center gap-3">
              <PixelButton variant={file ? "ghost" : "accent"} icon="upload" onClick={() => input.current?.click()}>
                {file ? t("sprite.replace") : t("sprite.upload")}
              </PixelButton>
              <span className="text-sm text-ink-soft">{t("sprite.fileHint")}</span>
            </div>
            {fileError && (
              <p role="alert" className="bg-peach-hi px-3 py-2 text-base shadow-[inset_4px_0_0_var(--color-peach-lo)]">
                {fileError}
              </p>
            )}
            {refUrl && (
              <figure className="flex flex-col gap-1.5">
                <div className="px-checker grid max-h-72 w-full max-w-sm place-items-center overflow-hidden shadow-[0_0_0_3px_var(--color-line)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={refUrl} alt={t("sprite.reference")} className="max-h-72 w-auto max-w-full object-contain" />
                </div>
                <figcaption className="text-sm text-ink-soft">
                  <span className="font-label text-[10px] uppercase text-label">{t("sprite.reference")}</span> · {t("sprite.referenceNote")}
                </figcaption>
              </figure>
            )}
            {file && (
              <>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 text-base leading-snug">
                  <input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} className="mt-1 size-5 shrink-0 accent-[var(--color-label)]" />
                  {t("sprite.permission")}
                </label>
                <div className="flex flex-wrap gap-3">
                  <PixelButton variant="magic" icon="sparkle" loading={generating} disabled={!permission || !status?.image} onClick={generate}>
                    {generating ? t("sprite.generating") : source?.kind === "ai" ? t("sprite.regenerate") : t("sprite.generate")}
                  </PixelButton>
                  <PixelButton variant="ghost" icon="image" disabled={!permission || generating} onClick={convert}>
                    {t("sprite.convert")}
                  </PixelButton>
                </div>
                {status && !status.image && (
                  <p className="flex items-start gap-2 text-sm leading-snug text-ink-soft" role="note">
                    <PixelIcon name="offline" size={12} className="mt-1 shrink-0 text-coral-deep" />
                    <span>
                      <span className="font-bold text-ink">{t("sprite.unavailable")}.</span> {t("sprite.unavailableHint")}
                    </span>
                  </p>
                )}
                <p className="text-sm text-ink-mute">{t("sprite.convertHint")}</p>
                {generating && (
                  <p role="status" className="flex items-center gap-2 font-label text-xs uppercase text-ink-soft">
                    {t("sprite.generating")} <LoadingDots className="text-label" /> <span className="normal-case">{t("sprite.generatingHint")}</span>
                  </p>
                )}
                {error && (
                  <div role="alert" className="flex flex-wrap items-center gap-3 bg-peach-hi px-3 py-2 text-base shadow-[inset_4px_0_0_var(--color-peach-lo)]">
                    {t("ai.errorTitle", { reason: error })}
                    {status?.image && permission && (
                      <PixelButton size="sm" variant="ghost" icon="undo" onClick={generate}>
                        {t("common.retry")}
                      </PixelButton>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* 2 · Result */}
          <div className="flex min-w-0 flex-col gap-4">
            {source && nothing && <p className="bg-butter-hi px-3 py-2 text-base">{t("sprite.nothingFound")}</p>}
            {shown && source && (
              <>
                <p className="font-label text-xs uppercase tracking-wide text-label">{t("sprite.result")} · {tx(`sprite.source.${sourceKind}`)}</p>
                <div className="flex flex-wrap items-end gap-5">
                  {source.kind === "ai" && (
                    <figure className="flex flex-col gap-1.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={source.url} alt={t("sprite.rawLabel")} className="px-checker size-24 object-contain shadow-[0_0_0_3px_var(--color-line)]" />
                      <figcaption className="font-label text-[10px] uppercase text-ink-soft">{t("sprite.rawLabel")}</figcaption>
                    </figure>
                  )}
                  <figure className="flex flex-col gap-1.5">
                    <ArtImage art={{ src: shown.sprite, width: 32, height: 32, placeholder: false }} alt={t("sprite.spriteLabel")} className="px-checker w-32 shadow-[0_0_0_3px_var(--color-line)]" />
                    <figcaption className="font-label text-[10px] uppercase text-ink-soft">{t("sprite.spriteLabel")}</figcaption>
                  </figure>
                  <figure className="flex flex-col gap-1.5">
                    <ArtImage art={{ src: shown.portrait, width: 96, height: 96, placeholder: false }} alt={t("sprite.portraitLabel")} className="px-checker w-24 shadow-[0_0_0_3px_var(--color-line)]" />
                    <figcaption className="font-label text-[10px] uppercase text-ink-soft">{t("sprite.portraitLabel")}</figcaption>
                  </figure>
                </div>
                <StagePreview sprite={shown.sprite} label={t("sprite.onStage")} />
                {spec && (
                  <p className={`flex items-center gap-2 text-sm ${spec.ok ? "text-mint-deep" : "text-coral-deep"}`}>
                    <PixelIcon name={spec.ok ? "check" : "close"} size={10} />
                    {spec.ok ? t("sprite.spec.ok") : spec.issues.map((i) => tx(`sprite.spec.${i}`)).join(" · ")}
                  </p>
                )}
                <fieldset className="flex flex-col gap-3 border-t-[3px] border-dashed border-line pt-4">
                  <legend className="sr-only">{t("sprite.options")}</legend>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-1 font-label text-xs uppercase text-label">{t("sprite.colors")}</span>
                    {[6, 8, 12, 16].map((n) => (
                      <PixelButton key={n} size="sm" variant={options.colors === n ? "accent" : "ghost"} aria-pressed={options.colors === n} onClick={() => setOptions({ ...options, colors: n })} className="min-w-11">
                        {n}
                      </PixelButton>
                    ))}
                  </div>
                  <Toggle label={t("sprite.outline")} checked={options.outline} onChange={(outline) => setOptions({ ...options, outline })} onLabel={t("common.on")} offLabel={t("common.off")} />
                  <Toggle label={t("sprite.removeBg")} checked={options.removeBackground} onChange={(removeBackground) => setOptions({ ...options, removeBackground })} onLabel={t("common.on")} offLabel={t("common.off")} />
                </fieldset>
                <div className="flex flex-wrap gap-3">
                  <PixelButton variant="primary" icon="check" onClick={saveResult}>
                    {t("sprite.save")}
                  </PixelButton>
                  <PixelButton variant="calm" icon="pencil" onClick={() => setEditorOpen(true)}>
                    {t("sprite.edit")}
                  </PixelButton>
                  <PixelButton
                    variant="ghost"
                    icon="trash"
                    onClick={() => {
                      setSource(null);
                      setResult(null);
                      setEdited(null);
                    }}
                  >
                    {t("sprite.discard")}
                  </PixelButton>
                </div>
              </>
            )}
            {savedMsg && (
              <p role="status" className="flex items-center gap-2 font-label text-xs uppercase text-mint-deep">
                <PixelIcon name="check" size={12} /> {savedMsg}
              </p>
            )}
          </div>
        </div>
      </Panel>

      <Panel title={t("sprite.library")}>
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <ArtImage art={current.sprite} alt="" showTag={false} className="px-checker w-16 shadow-[0_0_0_3px_var(--color-butter)]" />
            <div>
              <p className="font-label text-[10px] uppercase text-label">{t("sprite.currentArt")}</p>
              <p className="text-base">{current.custom ? t("studio.portrait.custom") : t("common.placeholder")}</p>
            </div>
          </div>
          {current.custom && (
            <PixelButton size="sm" variant="ghost" onClick={() => gameActions.applySprite(character.id, null)}>
              {t("sprite.usePlaceholder")}
            </PixelButton>
          )}
        </div>
        {save.sprites.length === 0 ? (
          <p className="text-base text-ink-mute">{t("sprite.libraryEmpty")}</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3">
            {save.sprites.map((a) => {
              const inUse = character.art?.assetId === a.assetId;
              return (
                <li key={a.assetId} className={`flex flex-col items-center gap-2 bg-well p-2 ${inUse ? "shadow-[0_0_0_3px_var(--color-butter-lo)]" : ""}`}>
                  <ArtImage art={{ src: a.sprite, width: 32, height: 32, placeholder: false }} alt={a.name} className="px-checker w-16" />
                  <p className="w-full truncate text-center text-sm">
                    {a.name} <span className="font-label text-[9px] uppercase text-ink-mute">{tx(`sprite.source.${a.source}`)}</span>
                  </p>
                  <div className="flex gap-1">
                    <PixelButton size="sm" variant={inUse ? "success" : "accent"} disabled={inUse} onClick={() => gameActions.applySprite(character.id, a)}>
                      {inUse ? t("sprite.inUse") : t("sprite.use")}
                    </PixelButton>
                    <PixelButton size="sm" variant="ghost" icon="trash" aria-label={`${t("sprite.deleteFromLibrary")}: ${a.name}`} onClick={() => gameActions.deleteSprite(a.assetId)} className="min-w-11" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <PixelEditor
        open={editorOpen}
        sprite={shown?.spriteImg ?? null}
        onClose={() => setEditorOpen(false)}
        onApply={(img) => {
          if (shown) setEdited({ ...shown, sprite: imgToDataURL(img), spriteImg: img });
          setEditorOpen(false);
        }}
      />
    </div>
  );
}
