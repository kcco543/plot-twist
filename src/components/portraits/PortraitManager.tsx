"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Panel } from "@/components/ui/Panel";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { Modal } from "@/components/ui/Modal";
import { CropEditor } from "./CropEditor";
import { PortraitEditorModal } from "./PortraitEditorModal";
import { getCharacterArt } from "@/assets/manifest";
import { gameActions } from "@/lib/gameStore";
import { libraryActions } from "@/lib/library/characterLibrary";
import { avatarFromImg, editableFromUrl, loadPixels, versionFromImg } from "@/lib/portraits/browser";
import {
  activeVersion, addVersion, avatarOutdated, createPortraits, presetRect, deleteVersion, forgetReference, isProtected, restoreGenerated, saveChanges, setActiveVersion, versionById, withAvatar,
  type CharacterPortraits, type CropPreset, type CropRect, type PortraitVersion,
} from "@/lib/portraits/model";
import type { Img } from "@/lib/sprites/pixelize";
import type { Character } from "@/lib/types";
import { useI18n } from "@/i18n";

/** Loads the active version's pixels (exact, no resampling). */
function usePixels(url: string | null) {
  const [img, setImg] = useState<Img | null>(null);
  useEffect(() => {
    let live = true;
    setImg(null);
    if (url) loadPixels(url).then((i) => live && setImg(i)).catch(() => live && setImg(null));
    return () => {
      live = false;
    };
  }, [url]);
  return img;
}

/**
 * Portrait & avatar: the editable full portrait, its version history and the
 * avatar crop. Everything here saves to THIS world's copy of the character.
 * Flow: Generate / Convert (Sprite Studio below) → Edit portrait → Choose
 * avatar → it appears in the character sidebar, cards and dialogue.
 */
export function PortraitManager({ character }: { character: Character }) {
  const { t, tx } = useI18n();
  const p = character.portraits ?? null;
  const active = p ? activeVersion(p) : null;
  const pixels = usePixels(active?.image ?? null);
  const [editing, setEditing] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = (next: CharacterPortraits | null) => gameActions.setPortraits(character.id, next);
  const name = character.name.trim() || t("common.unnamed");
  const kindLabel = (v: PortraitVersion) => tx(`portrait.kind.${v.kind}`);
  const date = (n: number) => new Date(n).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  /** Older art or a placeholder → the first editable version (the art itself is not changed). */
  const startFromCurrent = async () => {
    setBusy(true);
    try {
      const url = character.art?.portrait ?? getCharacterArt(character.portrait).portrait.src;
      const img = await editableFromUrl(url);
      const v = versionFromImg(img, "legacy", null);
      save(createPortraits(v, avatarFromImg(img, { x: 0, y: 0, w: img.w, h: img.h }, "custom")));
      setStatus(t("portrait.started"));
    } catch {
      setStatus(t("portrait.loadFailed"));
    } finally {
      setBusy(false);
    }
  };

  const onSaveEdit = (img: Img, asNew: boolean) => {
    if (!p || !active) return;
    const v = versionFromImg(img, "edited", active.id);
    const next = asNew ? addVersion(p, v) : saveChanges(p, { image: v.image, w: v.w, h: v.h, createdAt: v.createdAt }, v.id);
    save(next);
    setEditing(false);
    setStatus(asNew ? t("portrait.savedNew") : t("portrait.savedChanges"));
  };

  const applyCrop = (rect: CropRect, preset: CropPreset) => {
    if (!p || !pixels || !active) return;
    save(withAvatar(p, active.id, avatarFromImg(pixels, rect, preset)));
    setCropping(false);
    setStatus(t("portrait.avatarSaved"));
  };
  /** Re-cut the avatar from the current version with the SAVED crop box. */
  const updateAvatarFromCrop = () => {
    if (!p || !pixels || !active) return;
    save(withAvatar(p, active.id, avatarFromImg(pixels, p.avatarCropRect, p.avatarCropPreset)));
    setStatus(t("portrait.avatarUpdated"));
  };

  if (!p || !active) {
    return (
      <Panel title={t("portrait.title")}>
        <div className="flex flex-col gap-3" data-portrait-manager="empty">
          <p className="text-base leading-snug text-ink-soft">{t("portrait.emptyIntro")}</p>
          <div className="flex flex-wrap gap-3">
            <PixelButton variant="calm" icon="pencil" loading={busy} onClick={startFromCurrent}>
              {character.art ? t("portrait.startFromArt") : t("portrait.startFromPlaceholder")}
            </PixelButton>
          </div>
          {status && <p role="status" className="text-sm text-ink-soft">{status}</p>}
        </div>
      </Panel>
    );
  }

  const outdated = avatarOutdated(p) && dismissedFor !== p.activePortraitVersion;
  const generated = versionById(p, p.generatedPixelPortrait);
  const onGenerated = active.id === p.generatedPixelPortrait;

  return (
    <Panel title={t("portrait.title")} sparkles>
      <div className="flex flex-col gap-5" data-portrait-manager="ready">
        <p className="text-base leading-snug text-ink-soft">{t("portrait.intro")}</p>

        <div className="flex flex-wrap items-start gap-6">
          <figure className="flex flex-col gap-1.5">
            <div className="px-checker shadow-[0_0_0_3px_var(--color-line)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={active.image} alt={t("portrait.fullAlt", { name })} className="pixelated block w-40 sm:w-48" style={{ aspectRatio: `${active.w} / ${active.h}` }} data-portrait-full />
            </div>
            <figcaption className="font-label text-[10px] uppercase text-ink-soft">
              {t("portrait.full")} · {active.w}×{active.h} · {kindLabel(active)}
            </figcaption>
          </figure>
          <figure className="flex flex-col items-start gap-1.5">
            <div className="px-frame px-portrait relative" style={{ "--frame": "var(--frame-portrait)" } as CSSProperties}>
              <div className="px-checker grid size-24 place-items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.portraitAvatar} alt={t("portrait.avatarAlt")} className="pixelated max-h-full max-w-full object-contain" style={{ aspectRatio: `${p.avatarW} / ${p.avatarH}` }} data-portrait-avatar />
              </div>
            </div>
            <figcaption className="font-label text-[10px] uppercase text-ink-soft">
              {t("portrait.avatar")} · {t(`portrait.crop.preset.${p.avatarCropPreset}`)}
            </figcaption>
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.portraitThumbnail} alt="" className="pixelated size-8 object-contain shadow-[0_0_0_2px_var(--color-line)]" />
              <span className="text-sm text-ink-soft">{t("portrait.crop.thumb")}</span>
            </div>
          </figure>
          {p.originalReferenceImage && (
            <figure className="flex flex-col gap-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.originalReferenceImage} alt={t("portrait.referenceAlt")} className="block max-h-24 w-auto shadow-[0_0_0_3px_var(--color-line)]" />
              <figcaption className="max-w-40 text-sm leading-snug text-ink-soft">{t("portrait.referenceNote")}</figcaption>
              <PixelButton size="sm" variant="ghost" onClick={() => save(forgetReference(p))}>
                {t("portrait.forgetReference")}
              </PixelButton>
            </figure>
          )}
        </div>

        {outdated && (
          <div role="status" className="flex flex-col gap-2 bg-butter-hi px-3 py-2 shadow-[inset_4px_0_0_var(--color-butter-lo)]" data-avatar-outdated>
            <p className="text-base">{t("portrait.outdated")}</p>
            <div className="flex flex-wrap gap-2">
              <PixelButton size="sm" variant="accent" icon="crop" disabled={!pixels} onClick={updateAvatarFromCrop}>
                {t("portrait.updateFromCrop")}
              </PixelButton>
              <PixelButton size="sm" variant="ghost" icon="crop" disabled={!pixels} onClick={() => setCropping(true)}>
                {t("portrait.recrop")}
              </PixelButton>
              <PixelButton size="sm" variant="ghost" onClick={() => setDismissedFor(p.activePortraitVersion)}>
                {t("portrait.keepAvatar")}
              </PixelButton>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <PixelButton variant="calm" icon="pencil" disabled={!pixels} onClick={() => setEditing(true)}>
            {t("portrait.edit")}
          </PixelButton>
          <PixelButton variant="accent" icon="crop" disabled={!pixels} onClick={() => setCropping(true)}>
            {t("portrait.chooseAvatar")}
          </PixelButton>
          {generated && (
            <PixelButton variant="ghost" icon="undo" disabled={onGenerated} onClick={() => { save(restoreGenerated(p)); setStatus(t("portrait.restored")); }}>
              {t("portrait.restoreGenerated")}
            </PixelButton>
          )}
        </div>
        {status && (
          <p role="status" className="flex items-center gap-2 font-label text-xs uppercase text-mint-deep">
            <PixelIcon name="check" size={12} /> {status}
          </p>
        )}

        <section aria-label={t("portrait.versions")} className="flex flex-col gap-2 border-t-[3px] border-dashed border-line pt-4">
          <p className="font-label text-xs uppercase tracking-wide text-label">{t("portrait.versionsCount", { n: p.versions.length })}</p>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3" data-portrait-versions>
            {[...p.versions].reverse().map((v) => {
              const isActive = v.id === p.activePortraitVersion;
              return (
                <li key={v.id} className={`flex flex-col items-center gap-1.5 bg-well p-2 ${isActive ? "shadow-[0_0_0_3px_var(--color-butter-lo)]" : ""}`} data-version-kind={v.kind} data-active={isActive || undefined}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={v.image} alt="" className="px-checker pixelated w-16" style={{ aspectRatio: `${v.w} / ${v.h}` }} />
                  <p className="text-center text-sm leading-tight">
                    {kindLabel(v)}
                    {v.id === p.generatedPixelPortrait && <span className="block font-label text-[9px] uppercase text-label">{t("portrait.original")}</span>}
                    <span className="block font-label text-[9px] uppercase text-ink-mute">{date(v.createdAt)}</span>
                  </p>
                  <div className="flex gap-1">
                    <PixelButton size="sm" variant={isActive ? "success" : "accent"} disabled={isActive} onClick={() => save(setActiveVersion(p, v.id))}>
                      {isActive ? t("portrait.inUse") : t("portrait.use")}
                    </PixelButton>
                    {!isProtected(p, v.id) && (
                      <PixelButton size="sm" variant="ghost" icon="trash" aria-label={t("portrait.deleteVersion", { kind: kindLabel(v) })} onClick={() => save(deleteVersion(p, v.id))} className="min-w-11" />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="flex flex-wrap items-center gap-3 border-t-[3px] border-dashed border-line pt-4">
          <p className="min-w-0 flex-1 text-sm leading-snug text-ink-soft">{t("portrait.worldOnly")}</p>
          <PixelButton
            size="sm"
            variant="secondary"
            icon="book"
            onClick={() => {
              const tpl = libraryActions.saveFromCharacter(character);
              gameActions.linkToTemplate(character.id, tpl.id);
              setStatus(t("library.savedTemplate", { name }));
            }}
          >
            {t("portrait.saveTemplate")}
          </PixelButton>
          <PixelButton size="sm" variant="ghost" icon="trash" onClick={() => setConfirmRemove(true)}>
            {t("portrait.remove")}
          </PixelButton>
        </div>
      </div>

      <PortraitEditorModal
        open={editing}
        source={pixels}
        sourceLabel={kindLabel(active)}
        canSaveInPlace={active.kind === "edited" && active.id !== p.avatarSourceVersion}
        onClose={() => setEditing(false)}
        onSave={onSaveEdit}
      />
      <CropEditor
        open={cropping}
        img={pixels}
        initial={p.avatarCropRect}
        initialPreset={p.avatarCropPreset}
        onCancel={() => setCropping(false)}
        onConfirm={applyCrop}
      />
      <Modal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={t("portrait.removeTitle")}
        closeLabel={t("common.close")}
        size="sm"
        footer={
          <>
            <PixelButton size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
              {t("common.cancel")}
            </PixelButton>
            <PixelButton size="sm" variant="danger" icon="trash" onClick={() => { save(null); setConfirmRemove(false); }}>
              {t("portrait.removeConfirm")}
            </PixelButton>
          </>
        }
      >
        <p className="text-base leading-snug">{t("portrait.removeBody", { n: p.versions.length })}</p>
      </Modal>
    </Panel>
  );
}

/** First portrait (or a new version) from a fresh Generate / Convert result. Used by the Sprite Studio. */
export function portraitsAfterGeneration(current: CharacterPortraits | undefined, full: Img, kind: "generated" | "converted", reference: string | null): CharacterPortraits {
  const v = versionFromImg(full, kind, null, reference);
  if (!current) return createPortraits(v, avatarFromImg(full, presetRect(full, "head"), "head"));
  // A new original: the avatar is NOT re-cut silently; the outdated note offers it.
  return addVersion(current, v);
}
