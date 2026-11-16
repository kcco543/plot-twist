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
type Tool = "pencil" | "eraser" | "picker" | "fill" | "pan";
const ZOOMS = [1, 1.5, 2, 3, 4];


const TOOL_ICON = { pencil: "pencil", eraser: "eraser", fill: "bucket", pan: "hand" } as const;

/** 4-way flood fill of the clicked colour (exact RGBA match), hard edges only. */
export function floodFill(img: Img, sx: number, sy: number, rgba: [number, number, number, number]): Img {
  const data = new Uint8ClampedArray(img.data);
  const i0 = (sy * img.w + sx) * 4;
  const target = [data[i0], data[i0 + 1], data[i0 + 2], data[i0 + 3]];
  const transparentTarget = target[3] < 128;
  if (!transparentTarget && target.every((v, k) => v === rgba[k])) return img;
  const same = (i: number) => (transparentTarget ? data[i + 3] < 128 : data[i] === target[0] && data[i + 1] === target[1] && data[i + 2] === target[2] && data[i + 3] === target[3]);
  const stack = [sx + sy * img.w];
  const seen = new Uint8Array(img.w * img.h);
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!same(i)) continue;
    data.set(rgba, i);
    const x = p % img.w;
    if (x > 0) stack.push(p - 1);
    if (x < img.w - 1) stack.push(p + 1);
    if (p >= img.w) stack.push(p - img.w);
    if (p < img.w * (img.h - 1)) stack.push(p + img.w);
  }
  return { ...img, data };
}

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
  advanced = false,
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
  /** Portrait editing: fill, mirror drawing, zoom and pan as well (same surface, same undo). */
  advanced?: boolean;
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
  const [mirror, setMirror] = useState(false);
  const [zoom, setZoom] = useState(1);
  const drawing = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const panFrom = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

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
    if (tool === "pan") return;
    const { r, g, b } = hexToRgb(color);
    if (tool === "fill") {
      onChange(floodFill(img, x, y, [r, g, b, 255]));
      return;
    }
    const data = new Uint8ClampedArray(img.data);
    const put = (px: number) => {
      const k = (y * img.w + px) * 4;
      if (tool === "eraser") data.set([0, 0, 0, 0], k);
      else data.set([r, g, b, 255], k);
    };
    put(x);
    if (mirror) put(img.w - 1 - x);
    onChange({ ...img, data });
  };
  const undo = () => {
    if (!history.length) return;
    setFuture((f) => [...f, img.data]);
    onChange({ ...img, data: history[history.length - 1] });
    setHistory((h) => h.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    setHistory((h) => [...h.slice(-30), img.data]);
    onChange({ ...img, data: future[future.length - 1] });
    setFuture((f) => f.slice(0, -1));
  };
  const stepZoom = (d: number) => setZoom((z) => ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + d))]);
  /** Keyboard shortcuts while the editor has focus: B E I G H M, + −, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y. */
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "z") {
      if (e.shiftKey) redo();
      else undo();
    }
    else if (mod && k === "y") redo();
    else if (mod) return;
    else if (k === "b") setTool("pencil");
    else if (k === "e") setTool("eraser");
    else if (k === "i") setTool("picker");
    else if (advanced && k === "g") setTool("fill");
    else if (advanced && k === "h") setTool("pan");
    else if (advanced && k === "m") setMirror((m) => !m);
    else if (advanced && (k === "+" || k === "=")) stepZoom(1);
    else if (advanced && k === "-") stepZoom(-1);
    else return;
    e.preventDefault();
  };

  return (
      <div onKeyDown={onKey} className={`flex flex-col gap-4 ${stacked ? "sm:flex-row sm:items-start" : "md:flex-row md:items-start"}`}>
        <div
          ref={scroller}
          className={`w-full ${canvasClassName} shrink-0 self-center ${stacked ? "sm:self-start" : "md:self-start"} ${advanced ? "max-h-[60dvh] overflow-auto overscroll-contain" : ""}`}
        >
        <canvas
          tabIndex={0}
          ref={canvas}
          width={img.w * SCALE}
          height={img.h * SCALE}
          role="img"
          aria-label={label ?? t("editor.canvas")}
          style={advanced ? { width: `${zoom * 100}%`, maxWidth: "none" } : undefined}
          className={`pixelated block w-full px-focus ${tool === "pan" ? "cursor-grab" : "cursor-crosshair"} touch-none bg-well shadow-[0_0_0_3px_var(--color-line)]`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            if (tool === "pan") {
              const sc = scroller.current;
              panFrom.current = sc ? { x: e.clientX, y: e.clientY, left: sc.scrollLeft, top: sc.scrollTop } : null;
              return;
            }
            drawing.current = true;
            if (tool !== "picker") checkpoint();
            paint(...at(e));
          }}
          onPointerMove={(e) => {
            if (tool === "pan" && panFrom.current && scroller.current) {
              scroller.current.scrollLeft = panFrom.current.left - (e.clientX - panFrom.current.x);
              scroller.current.scrollTop = panFrom.current.top - (e.clientY - panFrom.current.y);
              return;
            }
            if (drawing.current && tool !== "picker" && tool !== "fill") paint(...at(e));
          }}
          onPointerUp={() => {
            drawing.current = false;
            panFrom.current = null;
          }}
          onPointerCancel={() => {
            drawing.current = false;
            panFrom.current = null;
          }}
        />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("editor.title")}>
            {((advanced ? ["pencil", "eraser", "fill", "pan"] : ["pencil", "eraser"]) as ("pencil" | "eraser" | "fill" | "pan")[]).map((k) => (
              <PixelButton key={k} size="sm" variant={tool === k ? "accent" : "ghost"} icon={TOOL_ICON[k]} role="radio" aria-checked={tool === k} onClick={() => setTool(k)}>
                {t(`editor.${k}`)}
              </PixelButton>
            ))}
            <PixelButton
              size="sm"
              variant="ghost"
              icon="undo"
              disabled={history.length === 0}
              onClick={undo}
            >
              {t("common.undo")}
            </PixelButton>
            <PixelButton
              size="sm"
              variant="ghost"
              icon="redo"
              disabled={future.length === 0}
              onClick={redo}
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
          {advanced && (
            <div className="flex flex-wrap items-center gap-2">
              <PixelButton size="sm" variant={mirror ? "accent" : "ghost"} icon="mirror" aria-pressed={mirror} onClick={() => setMirror((m) => !m)}>
                {t("editor.mirror")}
              </PixelButton>
              <span className="ml-1 font-label text-[10px] uppercase text-label">{t("editor.zoom")}</span>
              <PixelButton size="sm" variant="ghost" icon="minus" aria-label={t("editor.zoomOut")} disabled={zoom === ZOOMS[0]} onClick={() => stepZoom(-1)} className="min-w-11" />
              <span className="min-w-10 text-center font-label text-xs tabular-nums" aria-live="polite">{zoom}×</span>
              <PixelButton size="sm" variant="ghost" icon="plus" aria-label={t("editor.zoomIn")} disabled={zoom === ZOOMS[ZOOMS.length - 1]} onClick={() => stepZoom(1)} className="min-w-11" />
            </div>
          )}
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
