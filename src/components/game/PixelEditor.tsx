"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { paletteOf, type Img } from "@/lib/sprites/pixelize";
import { useI18n } from "@/i18n";

const EXTRA = ["#5b4a86", "#fffaf3", "#3d3060", "#f5a8c5", "#ffe08a", "#9de3c8", "#aab8f5", "#c3b2f0", "#ffc3a0"];
const SCALE = 10;
type Tool = "pencil" | "eraser" | "picker";

const hexToRgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Tiny 32×32 pixel editor for touching up a generated sprite. */
export function PixelEditor({ open, sprite, onClose, onApply }: { open: boolean; sprite: Img | null; onClose: () => void; onApply: (img: Img) => void }) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<Img | null>(null);
  const [history, setHistory] = useState<Uint8ClampedArray[]>([]);
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState("#5b4a86");
  const drawing = useRef(false);

  useEffect(() => {
    if (open && sprite) {
      setImg({ w: sprite.w, h: sprite.h, data: new Uint8ClampedArray(sprite.data) });
      setHistory([]);
    }
  }, [open, sprite]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    for (let y = 0; y < img.h; y++)
      for (let x = 0; x < img.w; x++) {
        const i = (y * img.w + x) * 4;
        if ((x + y) % 2 === 0) {
          ctx.fillStyle = "#efe8ff";
          ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
        }
        if (img.data[i + 3] < 128) continue;
        ctx.fillStyle = `rgb(${img.data[i]},${img.data[i + 1]},${img.data[i + 2]})`;
        ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
      }
    ctx.strokeStyle = "rgba(91,74,134,0.12)";
    for (let k = 0; k <= img.w; k++) {
      ctx.beginPath();
      ctx.moveTo(k * SCALE + 0.5, 0);
      ctx.lineTo(k * SCALE + 0.5, img.h * SCALE);
      ctx.moveTo(0, k * SCALE + 0.5);
      ctx.lineTo(img.w * SCALE, k * SCALE + 0.5);
      ctx.stroke();
    }
  }, [img]);

  if (!open || !img) return null;
  const palette = [...new Set([...paletteOf(img, 16), ...EXTRA])].slice(0, 24);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.floor(((e.clientX - r.left) / r.width) * img.w), Math.floor(((e.clientY - r.top) / r.height) * img.h)] as const;
  };
  const paint = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
    const i = (y * img.w + x) * 4;
    if (tool === "picker") {
      if (img.data[i + 3] >= 128) setColor("#" + [0, 1, 2].map((k) => img.data[i + k].toString(16).padStart(2, "0")).join(""));
      setTool("pencil");
      return;
    }
    const data = new Uint8ClampedArray(img.data);
    if (tool === "eraser") data[i + 3] = 0;
    else {
      const [r, g, b] = hexToRgb(color);
      data.set([r, g, b, 255], i);
    }
    setImg({ ...img, data });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("editor.title")}
      closeLabel={t("common.close")}
      size="lg"
      footer={
        <>
          <PixelButton size="sm" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </PixelButton>
          <PixelButton size="sm" variant="success" icon="check" onClick={() => onApply(img)}>
            {t("editor.apply")}
          </PixelButton>
        </>
      }
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <canvas
          ref={canvas}
          width={img.w * SCALE}
          height={img.h * SCALE}
          role="img"
          aria-label={t("editor.canvas")}
          className="pixelated w-full max-w-[320px] cursor-crosshair self-center touch-none bg-well shadow-[0_0_0_3px_var(--color-line)]"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            setHistory((h) => [...h.slice(-30), img.data]);
            paint(...at(e));
          }}
          onPointerMove={(e) => drawing.current && tool !== "picker" && paint(...at(e))}
          onPointerUp={() => (drawing.current = false)}
          onPointerCancel={() => (drawing.current = false)}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("editor.title")}>
            {(["pencil", "eraser", "picker"] as const).map((k) => (
              <PixelButton key={k} size="sm" variant={tool === k ? "accent" : "ghost"} icon={k === "pencil" ? "pencil" : k === "eraser" ? "eraser" : "drop"} role="radio" aria-checked={tool === k} onClick={() => setTool(k)}>
                {t(`editor.${k}`)}
              </PixelButton>
            ))}
            <PixelButton
              size="sm"
              variant="ghost"
              icon="undo"
              disabled={history.length === 0}
              onClick={() => {
                setImg({ ...img, data: history[history.length - 1] });
                setHistory((h) => h.slice(0, -1));
              }}
            >
              {t("common.undo")}
            </PixelButton>
          </div>
          <div className="grid grid-cols-8 gap-1.5" role="radiogroup" aria-label={t("editor.picker")}>
            {palette.map((hex) => (
              <button
                key={hex}
                type="button"
                role="radio"
                aria-checked={color === hex}
                aria-label={t("editor.color", { hex })}
                onClick={() => {
                  setColor(hex);
                  setTool("pencil");
                }}
                className={`px-focus aspect-square min-h-8 ${color === hex ? "shadow-[0_0_0_3px_var(--color-ink)]" : "shadow-[0_0_0_2px_var(--color-line)]"}`}
                style={{ background: hex }}
              />
            ))}
          </div>
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            <PixelIcon name="pencil" size={10} className="shrink-0" /> {t("editor.note")}
          </p>
        </div>
      </div>
    </Modal>
  );
}
