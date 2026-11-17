"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelCanvasEditor } from "@/components/game/PixelEditor";
import type { Img } from "@/lib/sprites/pixelize";
import { useI18n } from "@/i18n";

/**
 * The portrait in the game's own pixel editor (same surface as sprite and
 * gift editing), with fill, mirror, zoom and pan turned on. Edits change
 * real pixels of a working copy; nothing is saved until the player picks
 * Save changes or Save as new version.
 */
export function PortraitEditorModal({
  open,
  source,
  sourceLabel,
  canSaveInPlace,
  onClose,
  onSave,
}: {
  open: boolean;
  source: Img | null;
  sourceLabel: string;
  /** Save changes overwrites only an edited version (never the generated original). */
  canSaveInPlace: boolean;
  onClose: () => void;
  onSave: (img: Img, asNew: boolean) => void;
}) {
  const { t } = useI18n();
  const [img, setImg] = useState<Img | null>(null);
  useEffect(() => {
    if (open && source) setImg({ w: source.w, h: source.h, data: new Uint8ClampedArray(source.data) });
  }, [open, source]);
  if (!open || !img || !source) return null;
  const changed = img.data.some((v, i) => v !== source.data[i]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("portrait.editor.title")}
      closeLabel={t("common.close")}
      size="xl"
      footer={
        <>
          <PixelButton size="sm" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </PixelButton>
          <PixelButton size="sm" variant="calm" icon="layers" disabled={!changed} onClick={() => onSave(img, true)}>
            {t("portrait.editor.saveNew")}
          </PixelButton>
          <PixelButton size="sm" variant="primary" icon="check" disabled={!changed} onClick={() => onSave(img, !canSaveInPlace)}>
            {t("portrait.editor.save")}
          </PixelButton>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-soft">
        {t("portrait.editor.editing", { version: sourceLabel, w: img.w, h: img.h })} {canSaveInPlace ? t("portrait.editor.inPlace") : t("portrait.editor.keepsOriginal")}
      </p>
      <PixelCanvasEditor value={img} onChange={setImg} advanced canvasClassName="max-w-[448px]" label={t("portrait.editor.canvas", { w: img.w, h: img.h })} note={t("portrait.editor.note")} />
    </Modal>
  );
}
