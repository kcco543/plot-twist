"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { paletteOf, type Img } from "@/lib/sprites/pixelize";
import { hexToRgb } from "@/lib/color/color";
import { ColorPicker } from "./ColorPicker";
import { useI18n } from "@/i18n";

const EXTRA = ["#5b4a86", "#fffaf3", "#3d3060", "#f5a8c5", "#ffe08a", "#9de3c8", "#aab8f5", "#c3b2f0", "#ffc3a0"];
const SCALE = 10;
type Tool = "pencil" | "eraser" | "picker";


/**
 * Tiny 32×32 pixel editor for touching up a generated sprite, in a menu window.
 * The drawing surface itself is PixelCanvasEditor (also used by the Gift Creator).
 */
export function PixelEditor({ open, sprite, onClose, onApply }: { open: boolean; sprite: Img | null; onClose: () => void; onApply: (img: Img) => void }) {
  const { t } = useI18n();
  const [img, setImg] = useState<Img | null>(null);

  useEffect(() => {
    if (open && sprite) setImg({ w: sprite.w, h: sprite.h, data: new Uint8ClampedArray(sprite.data) });
  }, [open, sprite]);

  if (!open || !img) return null;

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
      <PixelCanvasEditor value={img} onChange={setImg} />
    </Modal>
  );
}

/**
 * The pixel editor's drawing surface: canvas (nearest-neighbour, transparent
 * pixels shown on a checkerboard), pencil / eraser, undo / redo, and the
 * colour picker (ColorPicker.tsx). Controlled: `value` in, every stroke out through `onChange`.
 * `note` replaces the hint under the palette; `onClear` adds a Clear button.
 */
export function PixelCanvasEditor({
  value: img,
  onChange,
  note,
  onClear,
  canvasClassName = "max-w-[320px]",
  label,
  stacked = false,
}: {
  value: Img;
  onChange: (img: Img) => void;
  note?: string;
  onClear?: () => void;
  canvasClassName?: string;
  /** Screen-reader name of the canvas (defaults to the sprite wording). */
  label?: string;
  /** Narrow column (Gift Creator): canvas and tools sit side by side from small screens up, with a smaller canvas. */
  stacked?: boolean;
}) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [history, setHistory] = useState<Uint8ClampedArray[]>([]);
  const [future, setFuture] = useState<Uint8ClampedArray[]>([]);
  /** Before a change: remember the current pixels for Undo, and forget anything that could be redone. */
  const checkpoint = () => {
    setHistory((h) => [...h.slice(-30), img.data]);
    setFuture([]);
  };
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState("#5b4a86");
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
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
    for (let k = 0; k <= Math.max(img.w, img.h); k++) {
      ctx.beginPath();
      ctx.moveTo(k * SCALE + 0.5, 0);
      ctx.lineTo(k * SCALE + 0.5, img.h * SCALE);
      ctx.moveTo(0, k * SCALE + 0.5);
      ctx.lineTo(img.w * SCALE, k * SCALE + 0.5);
      ctx.stroke();
    }
  }, [img]);

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
      const { r, g, b } = hexToRgb(color);
      data.set([r, g, b, 255], i);
    }
    onChange({ ...img, data });
  };

  return (
      <div className={`flex flex-col gap-4 ${stacked ? "sm:flex-row sm:items-start" : "md:flex-row md:items-start"}`}>
        <canvas
          ref={canvas}
          width={img.w * SCALE}
          height={img.h * SCALE}
          role="img"
          aria-label={label ?? t("editor.canvas")}
          className={`pixelated w-full ${canvasClassName} cursor-crosshair self-center ${stacked ? "sm:self-start" : ""} touch-none bg-well shadow-[0_0_0_3px_var(--color-line)]`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            if (tool !== "picker") checkpoint();
            paint(...at(e));
          }}
          onPointerMove={(e) => drawing.current && tool !== "picker" && paint(...at(e))}
          onPointerUp={() => (drawing.current = false)}
          onPointerCancel={() => (drawing.current = false)}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("editor.title")}>
            {(["pencil", "eraser"] as const).map((k) => (
              <PixelButton key={k} size="sm" variant={tool === k ? "accent" : "ghost"} icon={k === "pencil" ? "pencil" : "eraser"} role="radio" aria-checked={tool === k} onClick={() => setTool(k)}>
                {t(`editor.${k}`)}
              </PixelButton>
            ))}
            <PixelButton
              size="sm"
              variant="ghost"
              icon="undo"
              disabled={history.length === 0}
              onClick={() => {
                setFuture((f) => [...f, img.data]);
                onChange({ ...img, data: history[history.length - 1] });
                setHistory((h) => h.slice(0, -1));
              }}
            >
              {t("common.undo")}
            </PixelButton>
            <PixelButton
              size="sm"
              variant="ghost"
              icon="redo"
              disabled={future.length === 0}
              onClick={() => {
                setHistory((h) => [...h.slice(-30), img.data]);
                onChange({ ...img, data: future[future.length - 1] });
                setFuture((f) => f.slice(0, -1));
              }}
            >
              {t("editor.redo")}
            </PixelButton>
            {onClear && (
              <PixelButton
                size="sm"
                variant="ghost"
                icon="trash"
                onClick={() => {
                  checkpoint();
                  onClear();
                }}
              >
                {t("editor.clear")}
              </PixelButton>
            )}
          </div>
          <ColorPicker
            value={color}
            palette={palette}
            picking={tool === "picker"}
            onPickFromCanvas={() => setTool((k) => (k === "picker" ? "pencil" : "picker"))}
            onChange={(hex) => {
              setColor(hex);
              if (tool !== "pencil") setTool("pencil");
            }}
          />
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            <PixelIcon name="pencil" size={10} className="shrink-0" /> {note ?? t("editor.note")}
          </p>
        </div>
      </div>
  );
}
