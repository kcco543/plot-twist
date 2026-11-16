"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Modal } from "@/components/ui/Modal";
import { PixelButton, buttonStyle } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { imgToDataURL } from "@/lib/sprites/canvas";
import type { Img } from "@/lib/sprites/pixelize";
import { CROP_PRESETS, MIN_CROP, clampRect, presetRect, renderAvatar, type CropPreset, type CropRect } from "@/lib/portraits/model";
import { useI18n } from "@/i18n";

type Drag = { mode: "move" | "nw" | "ne" | "sw" | "se" | "new"; sx: number; sy: number; start: CropRect; ox: number; oy: number };
const ZOOMS = [1, 2, 3];

/**
 * Choose the avatar: draw, drag or resize a box on the FULL portrait. The
 * box is kept in source pixels (whole art pixels), never screen pixels, so
 * it can be applied again to a later version of the portrait.
 */
export function CropEditor({
  open,
  img,
  initial,
  initialPreset,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  img: Img | null;
  initial: CropRect | null;
  initialPreset: CropPreset;
  onCancel: () => void;
  onConfirm: (rect: CropRect, preset: CropPreset) => void;
}) {
  const { t } = useI18n();
  const [rect, setRect] = useState<CropRect | null>(null);
  const [preset, setPreset] = useState<CropPreset>(initialPreset);
  const [zoom, setZoom] = useState(1);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const src = useMemo(() => (img ? imgToDataURL(img) : ""), [img]);

  useEffect(() => {
    if (!open || !img) return;
    setRect(initial ? clampRect(initial, img.w, img.h) : presetRect(img, "head"));
    setPreset(initial ? initialPreset : "head");
    setZoom(1);
  }, [open, img, initial, initialPreset]);

  const preview = useMemo(() => {
    if (!img || !rect) return null;
    const { avatar, thumb } = renderAvatar(img, rect);
    return { avatar: imgToDataURL(avatar), aw: avatar.w, ah: avatar.h, thumb: imgToDataURL(thumb) };
  }, [img, rect]);

  if (!open || !img || !rect) return null;
  const square = preset !== "custom";

  /** Screen point → source pixel. */
  const toSrc = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * img.w, y: ((clientY - r.top) / r.height) * img.h };
  };
  const applyDrag = (clientX: number, clientY: number) => {
    const d = drag.current;
    if (!d) return;
    const p = toSrc(clientX, clientY);
    const dx = Math.round(p.x - d.sx);
    const dy = Math.round(p.y - d.sy);
    const s = d.start;
    let next: CropRect;
    if (d.mode === "move") next = { ...s, x: s.x + dx, y: s.y + dy };
    else if (d.mode === "new") {
      const x0 = Math.min(d.ox, Math.round(p.x));
      const y0 = Math.min(d.oy, Math.round(p.y));
      let w = Math.abs(Math.round(p.x) - d.ox);
      let h = Math.abs(Math.round(p.y) - d.oy);
      if (square) w = h = Math.max(w, h);
      next = { x: x0, y: y0, w: Math.max(MIN_CROP, w), h: Math.max(MIN_CROP, h) };
    } else {
      const left = d.mode === "nw" || d.mode === "sw";
      const top = d.mode === "nw" || d.mode === "ne";
      let w = s.w + (left ? -dx : dx);
      let h = s.h + (top ? -dy : dy);
      if (square) w = h = Math.max(w, h);
      w = Math.max(MIN_CROP, w);
      h = Math.max(MIN_CROP, h);
      next = { x: left ? s.x + s.w - w : s.x, y: top ? s.y + s.h - h : s.y, w, h };
    }
    setRect(clampRect(next, img.w, img.h));
  };
  const begin = (mode: Drag["mode"]) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    box.current?.setPointerCapture(e.pointerId);
    const p = toSrc(e.clientX, e.clientY);
    if (mode === "new") setPreset("custom");
    drag.current = { mode, sx: p.x, sy: p.y, start: rect, ox: Math.round(p.x), oy: Math.round(p.y) };
  };
  const pick = (p: CropPreset) => {
    setPreset(p);
    setRect(presetRect(img, p));
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step) return;
    e.preventDefault();
    const [x, y] = step;
    if (e.shiftKey) {
      const grow = x || y;
      setRect(clampRect({ ...rect, w: rect.w + grow, h: square ? rect.h + grow : rect.h + y }, img.w, img.h));
    } else setRect(clampRect({ ...rect, x: rect.x + x, y: rect.y + y }, img.w, img.h));
  };
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const handle = (mode: "nw" | "ne" | "sw" | "se", pos: CSSProperties) => (
    <span
      aria-hidden
      onPointerDown={begin(mode)}
      className="absolute size-6 touch-none"
      style={{ ...pos, cursor: mode === "nw" || mode === "se" ? "nwse-resize" : "nesw-resize" }}
    >
      <span className="absolute inset-[7px] bg-surface shadow-[0_0_0_2px_var(--color-ink)]" />
    </span>
  );

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={t("portrait.crop.title")}
      closeLabel={t("common.close")}
      size="xl"
      footer={
        <>
          <PixelButton size="sm" variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </PixelButton>
          <PixelButton size="sm" variant="primary" icon="check" onClick={() => onConfirm(rect, preset)}>
            {t("portrait.crop.confirm")}
          </PixelButton>
        </>
      }
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("portrait.crop.presets")}>
            {CROP_PRESETS.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={preset === p} onClick={() => (p === "custom" ? setPreset("custom") : pick(p))} className="px-btn min-h-11 px-2 text-[15px]" style={buttonStyle(preset === p ? "accent" : "ghost")}>
                {t(`portrait.crop.preset.${p}`)}
              </button>
            ))}
            <PixelButton size="sm" variant="magic" icon="sparkle" onClick={() => pick("head")}>
              {t("portrait.crop.auto")}
            </PixelButton>
          </div>
          <p className="text-sm leading-snug text-ink-soft">{t("portrait.crop.autoNote")}</p>
          <div className="max-h-[56dvh] w-full max-w-[448px] self-center overflow-auto overscroll-contain md:self-start">
            <div
              ref={box}
              tabIndex={0}
              role="application"
              aria-label={t("portrait.crop.area", { x: rect.x, y: rect.y, w: rect.w, h: rect.h })}
              onKeyDown={onKey}
              onPointerDown={begin("new")}
              onPointerMove={(e) => applyDrag(e.clientX, e.clientY)}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
              className="px-checker px-focus relative touch-none select-none"
              style={{ width: `${zoom * 100}%`, aspectRatio: `${img.w} / ${img.h}` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- exact pixels, nearest-neighbour */}
              <img src={src} alt="" draggable={false} className="pixelated absolute inset-0 size-full" />
              {/* dim outside the crop */}
              <div
                className="absolute"
                onPointerDown={begin("move")}
                style={{ left: pct(rect.x, img.w), top: pct(rect.y, img.h), width: pct(rect.w, img.w), height: pct(rect.h, img.h), boxShadow: "0 0 0 9999px rgba(var(--shadow-rgb), 0.45)", outline: "2px dashed var(--color-surface)", outlineOffset: "-1px", cursor: "move" }}
              >
                {handle("nw", { left: -12, top: -12 })}
                {handle("ne", { right: -12, top: -12 })}
                {handle("sw", { left: -12, bottom: -12 })}
                {handle("se", { right: -12, bottom: -12 })}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-label text-[10px] uppercase text-label">{t("editor.zoom")}</span>
            {ZOOMS.map((z) => (
              <PixelButton key={z} size="sm" variant={zoom === z ? "accent" : "ghost"} aria-pressed={zoom === z} onClick={() => setZoom(z)} className="min-w-11">
                {z}×
              </PixelButton>
            ))}
            <span className="ml-auto font-label text-[10px] uppercase tabular-nums text-ink-soft" data-crop-rect>
              {rect.x},{rect.y} · {rect.w}×{rect.h}
            </span>
          </div>
          <p className="flex items-start gap-2 text-sm text-ink-soft">
            <PixelIcon name="crop" size={10} className="mt-1 shrink-0" /> {t("portrait.crop.hint")}
          </p>
        </div>
        {preview && (
          <figure className="flex shrink-0 flex-col items-center gap-2 md:w-48">
            <figcaption className="font-label text-[10px] uppercase text-label">{t("portrait.crop.preview")}</figcaption>
            <div className="px-frame px-portrait relative" style={{ "--frame": "var(--frame-portrait)" } as CSSProperties}>
              <div className="px-checker grid size-28 place-items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview.avatar} alt={t("portrait.avatarAlt")} className="pixelated max-h-full max-w-full object-contain" style={{ aspectRatio: `${preview.aw} / ${preview.ah}` }} data-avatar-preview />
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.thumb} alt="" className="pixelated size-8 object-contain shadow-[0_0_0_2px_var(--color-line)]" />
              <span className="text-sm text-ink-soft">{t("portrait.crop.thumb")}</span>
            </div>
          </figure>
        )}
      </div>
    </Modal>
  );
}
