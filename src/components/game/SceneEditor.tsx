"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon, type IconName } from "@/components/ui/PixelIcon";
import { useI18n } from "@/i18n";
import { makeId } from "@/lib/id";
import { updateMapDetails, type GeneratedMap } from "@/lib/mapGenerator";
import { mapDisplayName } from "@/lib/scene/useScene";
import {
  STAGE_WIDTHS,
  SCENE_OBJECT_TYPES,
  OBJECT_ACTIONS_BY_TYPE,
  buildScene,
  defaultLayout,
  floorShare,
  footprintOf,
  guessFloor,
  lockedStageWidth,
  paintStroke,
  readLayout,
  type CharacterSize,
  type Perspective,
  type SceneLayout,
  type SceneObject,
} from "@/lib/scene/layout";
import {
  MIN_VERTICES,
  commit,
  edgeMidpoints,
  historyOf,
  insertVertex,
  moveVertex,
  pointInPolygon,
  polygonBounds,
  preview,
  rectToPolygon,
  redo as redoH,
  removeVertex,
  translatePolygon,
  undo as undoH,
  type History,
} from "@/lib/scene/geometry";
import { AMBIENT_KINDS, ambientSpec, defaultAmbientFor, type AmbientKind } from "@/lib/scene/ambient";
import type { Point, Rect } from "@/lib/stage/room";
import { EXIT_TYPES, type ObjectAction, type ObjectType } from "@/lib/stage/objects";
import { guessWalkable } from "@/lib/pixelArt/mapPixels";
import { blobToImg } from "@/lib/pixelArt/mapPixelsBrowser";

/**
 * Editing tools. Each one is an explicit mode, so a stroke can never be read
 * as anything else (and the game behind this window is paused: nothing here
 * moves a character or uses an object).
 */
type Tool = "walk" | "block" | "rect" | "pen" | "edit" | "spawn" | "anchor" | "pan";
const TOOL_ICONS: Record<Tool, IconName> = { walk: "drop", block: "eraser", rect: "plus", pen: "pencil", edit: "layers", spawn: "user", anchor: "pin", pan: "move" };
/** Brush radius presets, in MAP CELLS (so zooming the editor never changes the area a stroke covers). */
const BRUSH_PRESETS = { s: 1, m: 2, l: 4, xl: 7 } as const;
type BrushPreset = keyof typeof BRUSH_PRESETS;
const BRUSH_MIN = 0.5;
const BRUSH_MAX = 12;
const ZOOMS = [1, 1.5, 2, 3] as const;
const MIN_OBJECT = 0.015;
const SPAWN_HIT = 0.03;
/** Screen px within which a click closes the outline on its first point / grabs a handle. */
const CLOSE_PX = 12;

const pct = (v: number) => `${v * 100}%`;
const sizeOf = (w: number): CharacterSize => (Object.entries(STAGE_WIDTHS).reduce((best, [k, v]) => (Math.abs(v - w) < Math.abs(STAGE_WIDTHS[best] - w) ? (k as CharacterSize) : best), "medium" as CharacterSize));
const shapeOf = (o: SceneObject): Point[] => o.shape ?? rectToPolygon(o.bounds);
const insideObject = (o: SceneObject, p: Point) => (o.shape ? pointInPolygon(p, o.shape) : p.x >= o.bounds.x0 && p.x <= o.bounds.x1 && p.y >= o.bounds.y0 && p.y <= o.bounds.y1);

type Gesture =
  | { kind: "paint"; last: Point; base: SceneLayout }
  | { kind: "rect"; start: Point }
  | { kind: "vertex"; id: string; index: number; base: SceneLayout }
  | { kind: "move"; id: string; from: Point; shape: Point[]; base: SceneLayout }
  | { kind: "pan"; x: number; y: number; sl: number; st: number };

/**
 * PLAY AREA EDITOR — the navigation and interaction layer of a generated map.
 * The picture can't tell the game where the floor or the furniture is, so the
 * player marks it: walkable / blocked brushes (adjustable size, measured in
 * map cells), objects as boxes or pen-drawn outlines with editable points,
 * each with its gameplay metadata (collision, range, walk-to spot, actions,
 * linked character, interests, ambient animation), and start spots. Undo /
 * redo covers every change. Saved with the map, so every save using it plays
 * the same.
 */
export function SceneEditor({
  open,
  map,
  onClose,
  onSaved,
  cast = [],
  scenes = [],
}: {
  open: boolean;
  map: GeneratedMap;
  onClose: () => void;
  onSaved?: () => void;
  cast?: { id: string; name: string }[];
  /** Scenes of this world, for an object's optional linked scene. */
  scenes?: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const [hist, setHist] = useState<History<SceneLayout>>(() => historyOf(readLayout(map.scene, map.width, map.height)));
  const layout = hist.present;
  const [name, setName] = useState(() => mapDisplayName(map));
  const [tool, setToolState] = useState<Tool>("walk");
  const [brush, setBrush] = useState<number>(BRUSH_PRESETS.m);
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [vertex, setVertex] = useState<number | null>(null);
  const [pen, setPen] = useState<Point[]>([]);
  const [hover, setHover] = useState<Point | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState<Rect | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [focusName, setFocusName] = useState(0);
  const gesture = useRef<Gesture | null>(null);

  const setTool = useCallback((k: Tool) => {
    setToolState(k);
    if (k !== "pen") setPen([]);
    setVertex(null);
  }, []);
  // A new object: type its name straight away, without scrolling the picture out of view.
  useEffect(() => {
    if (focusName) nameRef.current?.focus({ preventScroll: true });
  }, [focusName]);

  /** A finished change: one undo step. */
  const commitLayout = useCallback((fn: (l: SceneLayout) => SceneLayout) => setHist((h) => commit(h, fn(h.present))), []);
  /** A change in progress (a stroke, a dragged point): shown live, one undo step when the gesture ends. */
  const previewLayout = useCallback((fn: (l: SceneLayout) => SceneLayout) => setHist((h) => preview(h, fn(h.present))), []);
  const endGesture = useCallback((base: SceneLayout) => setHist((h) => (h.present === base ? h : { past: [...h.past, base].slice(-60), present: h.present, future: [] })), []);
  const undo = useCallback(() => setHist(undoH), []);
  const redo = useCallback(() => setHist(redoH), []);

  // Start from what's stored each time the editor opens (Cancel throws the changes away).
  useEffect(() => {
    if (!open) return;
    setHist(historyOf(readLayout(map.scene, map.width, map.height)));
    setName(mapDisplayName(map));
    setSelected(null);
    setPen([]);
    setVertex(null);
    setError(false);
  }, [open, map]);

  // Maps on the pixel grid: "Rough guess" reads the picture's open ground instead of a fixed shape.
  const native = lockedStageWidth(map.width) !== null;
  const [groundGuess, setGroundGuess] = useState<{ id: string; floor: string | null } | null>(null);
  useEffect(() => {
    if (!open || !native) return;
    let live = true;
    const { cols, rows } = readLayout(map.scene, map.width, map.height);
    fetch(map.url)
      .then((r) => r.blob())
      .then(blobToImg)
      .then((img) => live && setGroundGuess({ id: map.id, floor: guessWalkable(img, cols, rows) }))
      .catch(() => live && setGroundGuess({ id: map.id, floor: null }));
    return () => {
      live = false;
    };
  }, [open, native, map]);
  const roughGuess = () => (groundGuess?.id === map.id && groundGuess.floor && groundGuess.floor.length === layout.cols * layout.rows ? groundGuess.floor : guessFloor(layout.cols, layout.rows, layout.perspective));

  const built = useMemo(() => buildScene(layout, map.width, map.height, map.type), [layout, map.width, map.height, map.type]);
  const unreachable = new Set(built.problems.map((p) => p.objectId));
  const share = floorShare(layout.floor);
  const sel = layout.objects.find((o) => o.id === selected) ?? null;
  const stageH = built.size.height;
  const cellPx = built.size.width / layout.cols;

  const frac = (e: { clientX: number; clientY: number }): Point => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  /** Screen distance between two fractional points (handles and the closing click are sized in screen px). */
  const screenDist = (a: Point, b: Point) => {
    const r = box.current!.getBoundingClientRect();
    return Math.hypot((a.x - b.x) * r.width, (a.y - b.y) * r.height);
  };
  const cell = (p: Point): Point => ({ x: p.x * layout.cols - 0.5, y: p.y * layout.rows - 0.5 });
  const patchObject = (id: string, p: Partial<SceneObject>) => commitLayout((l) => ({ ...l, objects: l.objects.map((o) => (o.id === id ? { ...o, ...p } : o)) }));
  const setShape = (l: SceneLayout, id: string, shape: Point[]): SceneLayout => ({ ...l, objects: l.objects.map((o) => (o.id === id ? { ...o, shape, bounds: polygonBounds(shape) } : o)) });

  const finishPen = useCallback(() => {
    if (pen.length < MIN_VERTICES) return;
    const shape = pen.map((p) => ({ ...p }));
    const o: SceneObject = { id: makeId("obj"), label: "", type: "feature", bounds: polygonBounds(shape), shape, solid: true, front: true };
    setHist((h) => commit(h, { ...h.present, objects: [...h.present.objects, o] }));
    setPen([]);
    setSelected(o.id);
    setToolState("edit");
    setFocusName((n) => n + 1);
  }, [pen]);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const middle = e.pointerType === "mouse" && e.button === 1;
    if (e.button !== 0 && e.pointerType === "mouse" && !middle) return;
    const p = frac(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    // Moving the view: the Move tool, or the middle mouse button with any tool.
    if (tool === "pan" || middle) {
      const sc = scroller.current;
      if (sc) gesture.current = { kind: "pan", x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop };
      return;
    }
    if (tool === "walk" || tool === "block") {
      const c = cell(p);
      const base = layout;
      previewLayout((l) => ({ ...l, floor: paintStroke(l, c, c, brush, tool === "walk") }));
      gesture.current = { kind: "paint", last: c, base };
    } else if (tool === "rect") {
      const hit = [...layout.objects].reverse().find((o) => insideObject(o, p));
      if (hit) {
        setSelected(hit.id);
        gesture.current = null;
        return;
      }
      gesture.current = { kind: "rect", start: p };
      setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    } else if (tool === "pen") {
      if (pen.length >= MIN_VERTICES && screenDist(p, pen[0]) <= CLOSE_PX) return finishPen();
      setPen((pts) => [...pts, p]);
    } else if (tool === "edit") {
      const target = e.target as HTMLElement;
      const handle = target.closest<HTMLElement>("[data-handle]");
      if (handle && sel) {
        const i = Number(handle.dataset.index);
        if (handle.dataset.handle === "mid") {
          const base = layout;
          const shape = insertVertex(shapeOf(sel), i, p);
          previewLayout((l) => setShape(l, sel.id, shape));
          setVertex(i + 1);
          gesture.current = { kind: "vertex", id: sel.id, index: i + 1, base };
        } else {
          setVertex(i);
          gesture.current = { kind: "vertex", id: sel.id, index: i, base: layout };
        }
        return;
      }
      const hit = (sel && insideObject(sel, p) ? sel : null) ?? [...layout.objects].reverse().find((o) => insideObject(o, p)) ?? null;
      setSelected(hit?.id ?? null);
      setVertex(null);
      if (hit) gesture.current = { kind: "move", id: hit.id, from: p, shape: shapeOf(hit), base: layout };
    } else if (tool === "anchor") {
      if (sel) patchObject(sel.id, { anchor: p });
      setTool("edit");
    } else if (tool === "spawn") {
      const near = layout.spawns.findIndex((s) => Math.hypot(s.x - p.x, s.y - p.y) < SPAWN_HIT);
      if (near >= 0) commitLayout((l) => ({ ...l, spawns: l.spawns.filter((_, i) => i !== near) }));
      else if (layout.spawns.length < 12) commitLayout((l) => ({ ...l, spawns: [...l.spawns, p] }));
      gesture.current = null;
    }
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = frac(e);
    setHover(p);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pan") {
      const sc = scroller.current;
      if (sc) {
        sc.scrollLeft = g.sl - (e.clientX - g.x);
        sc.scrollTop = g.st - (e.clientY - g.y);
      }
    } else if (g.kind === "paint") {
      const c = cell(p);
      const from = g.last;
      previewLayout((l) => ({ ...l, floor: paintStroke(l, from, c, brush, tool === "walk") }));
      g.last = c;
    } else if (g.kind === "rect") setDraft({ x0: Math.min(g.start.x, p.x), y0: Math.min(g.start.y, p.y), x1: Math.max(g.start.x, p.x), y1: Math.max(g.start.y, p.y) });
    else if (g.kind === "vertex") {
      const o = layout.objects.find((x) => x.id === g.id);
      if (o) previewLayout((l) => setShape(l, g.id, moveVertex(shapeOf(o), g.index, p)));
    } else if (g.kind === "move") previewLayout((l) => setShape(l, g.id, translatePolygon(g.shape, p.x - g.from.x, p.y - g.from.y)));
  };
  const onUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === "paint" || g.kind === "vertex" || g.kind === "move") endGesture(g.base);
    if (g.kind === "rect" && draft) {
      if (draft.x1 - draft.x0 >= MIN_OBJECT && draft.y1 - draft.y0 >= MIN_OBJECT) {
        const o: SceneObject = { id: makeId("obj"), label: "", type: "feature", bounds: draft, solid: true, front: true };
        commitLayout((l) => ({ ...l, objects: [...l.objects, o] }));
        setSelected(o.id);
        setFocusName((n) => n + 1);
      }
      setDraft(null);
    }
  };
  const deleteVertex = useCallback(
    (i: number) => {
      if (!sel) return;
      const shape = shapeOf(sel);
      if (shape.length <= MIN_VERTICES) return;
      setHist((h) => commit(h, setShape(h.present, sel.id, removeVertex(shape, i))));
      setVertex(null);
    },
    [sel],
  );

  // Keyboard: undo / redo, finishing or cancelling an outline, deleting a point. Captured before the
  // window's own Escape (which would close the editor) only while an outline is being drawn.
  useEffect(() => {
    if (!open) return;
    const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.isComposing) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        redo();
      } else if (tool === "pen" && pen.length && (k === "escape" || k === "backspace" || k === "enter")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (k === "escape") setPen([]);
        else if (k === "backspace") setPen((pts) => pts.slice(0, -1));
        else finishPen();
      } else if (tool === "edit" && vertex !== null && (k === "delete" || k === "backspace")) {
        e.preventDefault();
        deleteVertex(vertex);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, tool, pen.length, vertex, undo, redo, finishPen, deleteVertex]);

  const save = async () => {
    setSaving(true);
    setError(false);
    const ok = await updateMapDetails(map.id, { name: name.trim().slice(0, 40), scene: { ...layout, reviewed: true, updatedAt: Date.now() } });
    setSaving(false);
    if (!ok) return setError(true);
    onSaved?.();
    onClose();
  };

  // Floor cells as one SVG path (in grid units).
  const floorPath = useMemo(() => {
    let d = "";
    for (let r = 0; r < layout.rows; r++) {
      let c = 0;
      while (c < layout.cols) {
        if (layout.floor[r * layout.cols + c] !== "1") {
          c++;
          continue;
        }
        const start = c;
        while (c < layout.cols && layout.floor[r * layout.cols + c] === "1") c++;
        d += `M${start} ${r}h${c - start}v1h${start - c}z`;
      }
    }
    return d;
  }, [layout.floor, layout.cols, layout.rows]);

  const toolButton = (k: Tool) => (
    <PixelButton key={k} size="sm" variant={tool === k ? "accent" : "ghost"} icon={TOOL_ICONS[k]} aria-pressed={tool === k} onClick={() => setTool(k)} data-tool={k} className="px-2">
      {t(`playArea.tools.${k}`)}
    </PixelButton>
  );
  const painting = tool === "walk" || tool === "block";
  const preset = (Object.keys(BRUSH_PRESETS) as BrushPreset[]).find((k) => BRUSH_PRESETS[k] === brush) ?? null;
  const cursor = tool === "pan" ? (gesture.current?.kind === "pan" ? "grabbing" : "grab") : painting ? "none" : tool === "rect" || tool === "pen" || tool === "anchor" ? "crosshair" : tool === "spawn" ? "copy" : "default";
  const ratio = map.width / map.height;
  const availableActions = sel ? (OBJECT_ACTIONS_BY_TYPE[sel.type] ?? ["inspect"]) : [];
  const ambientValue = sel ? (sel.ambient === undefined ? "auto" : sel.ambient === null || !sel.ambient.enabled ? "none" : sel.ambient.kind) : "auto";
  const autoAmbient = sel ? defaultAmbientFor({ id: sel.id, type: sel.type, tags: [sel.type, ...(sel.interests ?? [])], label: sel.label }) : null;
  const selShape = sel ? shapeOf(sel) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("playArea.title")}
      closeLabel={t("common.close")}
      size="2xl"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {error && <span className="mr-auto text-sm text-coral-deep">{t("playArea.saveFailed")}</span>}
          <PixelButton variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </PixelButton>
          <PixelButton variant="primary" icon="check" loading={saving} onClick={() => void save()} data-scene-save>
            {t("playArea.save")}
          </PixelButton>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]" data-scene-editor>
        <div className="flex min-w-0 flex-col gap-3">
          {/* Tools, grouped: what you paint, how you mark objects, how you look around. */}
          <div className="flex flex-col gap-2" role="toolbar" aria-label={t("playArea.toolsLabel")}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-16 shrink-0 font-label text-[10px] uppercase text-ink-mute">{t("playArea.toolGroups.paint")}</span>
              {toolButton("walk")}
              {toolButton("block")}
              {toolButton("spawn")}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-16 shrink-0 font-label text-[10px] uppercase text-ink-mute">{t("playArea.toolGroups.objects")}</span>
              {toolButton("rect")}
              {toolButton("pen")}
              {toolButton("edit")}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-16 shrink-0 font-label text-[10px] uppercase text-ink-mute">{t("playArea.toolGroups.view")}</span>
              {toolButton("pan")}
              <span className="flex items-center gap-1" role="group" aria-label={t("playArea.zoom")}>
                {ZOOMS.map((z) => (
                  <PixelButton key={z} size="sm" variant={zoom === z ? "accent" : "ghost"} aria-pressed={zoom === z} onClick={() => setZoom(z)} className="min-w-11 px-1" data-editor-zoom={z}>
                    {z}×
                  </PixelButton>
                ))}
              </span>
              <span className="ml-auto flex items-center gap-1">
                <PixelButton size="sm" variant="ghost" icon="undo" disabled={!hist.past.length} onClick={undo} aria-label={t("playArea.undo")} className="px-2" data-editor-undo>
                  <span className="hidden sm:inline">{t("playArea.undo")}</span>
                </PixelButton>
                <PixelButton size="sm" variant="ghost" icon="redo" disabled={!hist.future.length} onClick={redo} aria-label={t("playArea.redo")} className="px-2" data-editor-redo>
                  <span className="hidden sm:inline">{t("playArea.redo")}</span>
                </PixelButton>
              </span>
            </div>
            {painting && (
              <div className="flex flex-wrap items-center gap-2 bg-well px-2 py-1.5" data-brush-controls>
                <span className="font-label text-[10px] uppercase text-label">{t("playArea.brushSize")}</span>
                {(Object.keys(BRUSH_PRESETS) as BrushPreset[]).map((b) => (
                  <PixelButton key={b} size="sm" variant={preset === b ? "accent" : "ghost"} aria-pressed={preset === b} onClick={() => setBrush(BRUSH_PRESETS[b])} className="min-w-11 px-1" data-brush={b}>
                    {t(`playArea.brushes.${b}`)}
                  </PixelButton>
                ))}
                <input
                  type="range"
                  min={BRUSH_MIN}
                  max={BRUSH_MAX}
                  step={0.5}
                  value={brush}
                  onChange={(e) => setBrush(Number(e.target.value))}
                  aria-label={t("playArea.brushSize")}
                  className="px-range min-w-28 flex-1"
                  style={{ "--fill": `${((brush - BRUSH_MIN) / (BRUSH_MAX - BRUSH_MIN)) * 100}%` } as CSSProperties}
                  data-brush-slider
                />
                <span className="font-label text-[10px] uppercase tabular-nums text-ink-soft" data-brush-size={brush}>
                  {t("playArea.brushCells", { n: String(brush * 2), px: String(Math.round(brush * 2 * cellPx)) })}
                </span>
              </div>
            )}
            {tool === "pen" && (
              <div className="flex flex-wrap items-center gap-2 bg-well px-2 py-1.5" data-pen-controls>
                <span className="font-label text-[10px] uppercase text-label">{t("playArea.points", { n: String(pen.length) })}</span>
                <PixelButton size="sm" variant="success" icon="check" disabled={pen.length < MIN_VERTICES} onClick={finishPen} data-pen-finish>
                  {t("playArea.finish")}
                </PixelButton>
                <PixelButton size="sm" variant="ghost" icon="undo" disabled={!pen.length} onClick={() => setPen((pts) => pts.slice(0, -1))}>
                  {t("playArea.undo")}
                </PixelButton>
                <PixelButton size="sm" variant="ghost" icon="close" disabled={!pen.length} onClick={() => setPen([])}>
                  {t("playArea.cancelOutline")}
                </PixelButton>
              </div>
            )}
          </div>

          {/* The picture with the navigation layer on top. Same aspect ratio as the map, never stretched.
              Zoomed in, it scrolls inside this frame (wheel, the Move tool or the middle mouse button). */}
          <div ref={scroller} className="relative max-h-[max(15rem,min(62dvh,calc(100dvh-26rem)))] overflow-auto overscroll-contain shadow-[0_0_0_2px_var(--color-line)]" data-scene-scroller>
            <div
              ref={box}
              data-scene-canvas
              data-active-tool={tool}
              className="relative mx-auto touch-none select-none"
              style={{ aspectRatio: `${ratio}`, width: `${zoom * 100}%`, maxWidth: `calc(max(15rem, min(60dvh, 100dvh - 27rem)) * ${ratio} * ${zoom})`, cursor }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onPointerLeave={() => setHover(null)}
              onDoubleClick={(e) => {
                const h = (e.target as HTMLElement).closest<HTMLElement>("[data-handle='vertex']");
                if (h && tool === "edit") deleteVertex(Number(h.dataset.index));
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- generated blob */}
              <img src={map.url} alt={name} draggable={false} className={`${native ? "pixelated " : ""}absolute inset-0 block size-full`} />
              <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${layout.cols} ${layout.rows}`} preserveAspectRatio="none" aria-hidden>
                <path d={floorPath} fill="rgb(120 220 170 / 0.38)" stroke="none" />
                {/* Brush preview: exactly the cells a click here would paint. */}
                {painting && hover && (
                  <ellipse
                    data-brush-cursor
                    cx={hover.x * layout.cols}
                    cy={hover.y * layout.rows}
                    rx={brush + 0.35}
                    ry={brush + 0.35}
                    fill={tool === "walk" ? "rgb(120 220 170 / 0.25)" : "rgb(194 87 63 / 0.22)"}
                    stroke={tool === "walk" ? "#2a8a6d" : "#c2573f"}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray="4 3"
                  />
                )}
              </svg>
              {/* Objects: drawn outlines and boxes in the same fractional space as the stored geometry. */}
              <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
                {layout.objects.map((o) => {
                  const foot = o.solid ? footprintOf(o.bounds, layout.perspective) : null;
                  const bad = unreachable.has(o.id);
                  const isSel = o.id === selected;
                  const pts = shapeOf(o).map((p) => `${p.x},${p.y}`).join(" ");
                  return (
                    <g key={o.id} data-scene-object={o.id}>
                      {foot && !o.shape && <rect x={foot.x0} y={foot.y0} width={foot.x1 - foot.x0} height={foot.y1 - foot.y0} fill="rgb(194 87 63 / 0.3)" />}
                      <polygon
                        points={pts}
                        fill={isSel ? "rgb(255 224 138 / 0.22)" : "rgb(255 255 255 / 0.08)"}
                        stroke={bad ? "#c2573f" : isSel ? "#e8b85a" : "white"}
                        strokeWidth={isSel ? 3 : 2}
                        strokeDasharray={isSel ? undefined : "5 4"}
                        vectorEffect="non-scaling-stroke"
                      />
                      {o.anchor && <circle cx={o.anchor.x} cy={o.anchor.y} r={0.006} fill="#7653c2" stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
                    </g>
                  );
                })}
                {pen.length > 0 && (
                  <g data-pen-preview>
                    <polyline points={[...pen, ...(hover ? [hover] : [])].map((p) => `${p.x},${p.y}`).join(" ")} fill="rgb(118 83 194 / 0.12)" stroke="#7653c2" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  </g>
                )}
              </svg>
              {layout.objects.map((o) => (
                <span key={o.id} className="pointer-events-none absolute max-w-[40%] truncate bg-white/90 px-1 text-[11px] leading-tight text-ink" style={{ left: pct(o.bounds.x0), top: pct(o.bounds.y0) }}>
                  {o.label || t(`playArea.types.${o.type}`)}
                </span>
              ))}
              {pen.map((p, i) => (
                <span
                  key={i}
                  data-pen-point={i}
                  className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 border-2 border-white ${i === 0 && pen.length >= MIN_VERTICES ? "size-4 bg-butter" : "size-2.5 bg-label"}`}
                  style={{ left: pct(p.x), top: pct(p.y) }}
                />
              ))}
              {/* Shape handles: vertices (drag / select / double-click to delete) and edge "+" (add a point). */}
              {tool === "edit" && selShape && (
                <>
                  {edgeMidpoints(selShape).map((m, i) =>
                    selShape.length < 48 ? (
                      <span key={`m${i}`} data-handle="mid" data-index={i} className="absolute grid size-4 -translate-x-1/2 -translate-y-1/2 cursor-copy place-items-center bg-white/90 text-[10px] font-bold leading-none text-label shadow-[0_0_0_1px_var(--color-label)]" style={{ left: pct(m.x), top: pct(m.y) }}>
                        +
                      </span>
                    ) : null,
                  )}
                  {selShape.map((p, i) => (
                    <span
                      key={`v${i}`}
                      data-handle="vertex"
                      data-index={i}
                      className={`absolute size-4 -translate-x-1/2 -translate-y-1/2 cursor-move border-2 border-white ${vertex === i ? "bg-coral-deep" : "bg-butter-lo"}`}
                      style={{ left: pct(p.x), top: pct(p.y) }}
                    />
                  ))}
                </>
              )}
              {draft && <span className="pointer-events-none absolute border-2 border-dashed border-label bg-label/15" style={{ left: pct(draft.x0), top: pct(draft.y0), width: pct(draft.x1 - draft.x0), height: pct(draft.y1 - draft.y0) }} />}
              {layout.spawns.map((s, i) => (
                // A character-sized marker, so the chosen character size can be judged against the furniture.
                <span
                  key={i}
                  data-scene-spawn
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-full border-2 border-label bg-label/25"
                  style={{ left: pct(s.x), top: pct(s.y), width: pct(18 / layout.stageWidth), height: pct(28 / stageH) } as CSSProperties}
                >
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2 bg-label px-1 text-[10px] leading-tight text-white">{i + 1}</span>
                </span>
              ))}
            </div>
            {/* Active tool, always visible on the picture. */}
            <span className="pointer-events-none sticky bottom-1 left-1 ml-1 inline-flex items-center gap-1 bg-plum/85 px-1.5 py-0.5 font-label text-[10px] uppercase text-white" data-active-tool-badge>
              <PixelIcon name={TOOL_ICONS[tool]} size={9} />
              {t("playArea.active", { tool: t(`playArea.tools.${tool}`) })}
              {painting && ` · ${brush * 2}`}
            </span>
          </div>
          <p className="text-sm text-ink-mute" data-tool-hint>
            {t(`playArea.hints.${tool}`)}
          </p>
        </div>

        <div className="grid content-start gap-4 md:grid-cols-2 lg:grid-cols-1">
          <div className="flex flex-col gap-3">
            <p className="hidden text-sm leading-snug text-ink-soft sm:block">{t("playArea.intro")}</p>
            <label className="flex flex-col gap-1">
              <span className="font-label text-xs uppercase tracking-wide text-label">{t("playArea.name")}</span>
              <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="px-input min-h-11 px-2 text-lg" data-scene-name />
            </label>
            <div className="flex flex-col gap-1">
              <span className="font-label text-xs uppercase tracking-wide text-label">{t("playArea.perspective")}</span>
              <div className="flex flex-wrap gap-2">
                {(["angled", "side"] as Perspective[]).map((p) => (
                  <PixelButton key={p} size="sm" variant={layout.perspective === p ? "accent" : "ghost"} aria-pressed={layout.perspective === p} onClick={() => commitLayout((l) => ({ ...l, perspective: p }))}>
                    {t(`playArea.perspectives.${p}`)}
                  </PixelButton>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-label text-xs uppercase tracking-wide text-label">{t("playArea.characterSize")}</span>
              {native ? (
                <p className="text-sm text-ink-soft" data-pixel-grid-size>
                  {t("playArea.pixelGridSize")}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(STAGE_WIDTHS) as CharacterSize[]).map((k) => (
                    <PixelButton key={k} size="sm" variant={sizeOf(layout.stageWidth) === k ? "accent" : "ghost"} aria-pressed={sizeOf(layout.stageWidth) === k} onClick={() => commitLayout((l) => ({ ...l, stageWidth: STAGE_WIDTHS[k] }))}>
                      {t(`playArea.sizes.${k}`)}
                    </PixelButton>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-label text-xs uppercase tracking-wide text-label">
                {t("playArea.floor")} · {Math.round(share * 100)}%
              </span>
              <div className="flex flex-wrap gap-2">
                <PixelButton size="sm" variant="ghost" icon="undo" onClick={() => commitLayout((l) => ({ ...l, floor: roughGuess() }))}>
                  {t("playArea.resetGuess")}
                </PixelButton>
                <PixelButton size="sm" variant="ghost" onClick={() => commitLayout((l) => ({ ...l, floor: "1".repeat(l.cols * l.rows) }))}>
                  {t("playArea.fillAll")}
                </PixelButton>
                <PixelButton size="sm" variant="ghost" icon="trash" onClick={() => commitLayout((l) => ({ ...l, floor: "0".repeat(l.cols * l.rows) }))}>
                  {t("playArea.clearAll")}
                </PixelButton>
                <PixelButton size="sm" variant="ghost" icon="trash" onClick={() => commitLayout((l) => ({ ...defaultLayout(map.width, map.height, l.perspective), stageWidth: l.stageWidth }))}>
                  {t("playArea.startOver")}
                </PixelButton>
              </div>
              {share < 0.02 ? <p className="text-sm text-coral-deep">{t("playArea.noFloor")}</p> : <p className="text-sm text-ink-mute">{t("playArea.groundHint")}</p>}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <span className="font-label text-xs uppercase tracking-wide text-label">
              {t("playArea.objects")} · {layout.objects.length}
            </span>
            {layout.objects.length === 0 && <p className="text-sm text-ink-mute">{t("playArea.noObjectsPen")}</p>}
            <ul className="flex flex-wrap gap-1.5">
              {layout.objects.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(o.id);
                      setTool("edit");
                    }}
                    aria-pressed={o.id === selected}
                    className={`px-focus flex items-center gap-1 px-2 py-1 text-sm ${o.id === selected ? "bg-butter" : "bg-well"} ${unreachable.has(o.id) ? "text-coral-deep" : "text-ink"}`}
                    data-object-chip={o.id}
                  >
                    {unreachable.has(o.id) && <PixelIcon name="close" size={8} />}
                    {o.shape && <PixelIcon name="pencil" size={8} className="text-label" />}
                    {o.label || t(`playArea.types.${o.type}`)}
                  </button>
                </li>
              ))}
            </ul>
            {sel && selShape && (
              <div className="flex flex-col gap-2 bg-well p-2" data-scene-object-editor>
                <label className="flex flex-col gap-1">
                  <span className="font-label text-[10px] uppercase text-label">{t("playArea.objectName")}</span>
                  <input ref={nameRef} value={sel.label} maxLength={40} placeholder={t("playArea.objectNamePlaceholder")} onChange={(e) => patchObject(sel.id, { label: e.target.value })} className="px-input min-h-11 px-2" data-scene-object-name />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-label text-[10px] uppercase text-label">{t("playArea.objectType")}</span>
                  <select value={sel.type} onChange={(e) => patchObject(sel.id, { type: e.target.value as ObjectType, actions: undefined })} className="px-input min-h-11 px-2" data-object-type>
                    {SCENE_OBJECT_TYPES.map((k) => (
                      <option key={k} value={k}>
                        {t(`playArea.types.${k}`)}
                      </option>
                    ))}
                  </select>
                </label>
                {/* Geometry */}
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-label text-[10px] uppercase text-label">{t("playArea.outline")}</span>
                  <span className="text-ink-soft" data-object-outline={sel.shape ? "poly" : "box"}>
                    {sel.shape ? t("playArea.outlinePoly", { n: String(sel.shape.length) }) : t("playArea.outlineBox")}
                  </span>
                  {tool === "edit" && vertex !== null && selShape.length > MIN_VERTICES && (
                    <PixelButton size="sm" variant="ghost" icon="trash" onClick={() => deleteVertex(vertex)} data-delete-vertex>
                      {t("playArea.deletePoint")}
                    </PixelButton>
                  )}
                  {sel.shape && (
                    <PixelButton size="sm" variant="ghost" onClick={() => patchObject(sel.id, { shape: undefined })}>
                      {t("playArea.toRect")}
                    </PixelButton>
                  )}
                  {tool !== "edit" && (
                    <PixelButton size="sm" variant="ghost" icon="layers" onClick={() => setTool("edit")}>
                      {t("playArea.tools.edit")}
                    </PixelButton>
                  )}
                </div>
                {/* Collision */}
                <div className="flex flex-col gap-1">
                  <span className="font-label text-[10px] uppercase text-label">{t("playArea.collision")}</span>
                  <div className="flex flex-wrap gap-1.5">
                    <PixelButton size="sm" variant={sel.solid ? "ghost" : "accent"} aria-pressed={!sel.solid} onClick={() => patchObject(sel.id, { solid: false, front: false })} data-collision="walk">
                      {t("playArea.collisionWalk")}
                    </PixelButton>
                    <PixelButton size="sm" variant={sel.solid ? "accent" : "ghost"} aria-pressed={sel.solid} onClick={() => patchObject(sel.id, { solid: true })} data-collision="solid">
                      {t("playArea.collisionSolid")}
                    </PixelButton>
                  </div>
                </div>
                <label className={`flex items-center gap-2 text-base ${sel.solid ? "" : "opacity-50"}`}>
                  <input type="checkbox" disabled={!sel.solid} checked={sel.front} onChange={(e) => patchObject(sel.id, { front: e.target.checked })} className="size-5" />
                  {t("playArea.front")}
                </label>
                {/* Interaction range + walk-to spot */}
                <label className="flex flex-col gap-1">
                  <span className="flex justify-between font-label text-[10px] uppercase text-label">
                    {t("playArea.range")}
                    <span className="tabular-nums text-ink-soft">{t("playArea.rangeValue", { n: String(sel.range ?? 6) })}</span>
                  </span>
                  <input type="range" min={2} max={40} step={1} value={sel.range ?? 6} onChange={(e) => patchObject(sel.id, { range: Number(e.target.value) })} className="px-range" style={{ "--fill": `${(((sel.range ?? 6) - 2) / 38) * 100}%` } as CSSProperties} data-object-range />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-label text-[10px] uppercase text-label">{t("playArea.walkTo")}</span>
                  <span className="text-sm text-ink-soft">{sel.anchor ? t("playArea.walkToCustom") : t("playArea.walkToAuto")}</span>
                  <PixelButton size="sm" variant={tool === "anchor" ? "accent" : "ghost"} icon="pin" onClick={() => setTool("anchor")} data-set-anchor>
                    {t("playArea.walkToSet")}
                  </PixelButton>
                  {sel.anchor && (
                    <PixelButton size="sm" variant="ghost" onClick={() => patchObject(sel.id, { anchor: null })}>
                      {t("playArea.walkToClear")}
                    </PixelButton>
                  )}
                </div>
                {/* Supported actions */}
                {availableActions.length > 1 && (
                  <fieldset className="flex flex-col gap-1">
                    <legend className="mb-1 font-label text-[10px] uppercase text-label">{t("playArea.actions")}</legend>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {availableActions.map((a) => {
                        const on = (sel.actions ?? availableActions).includes(a);
                        const toggle = () => {
                          const cur = sel.actions ?? availableActions;
                          const next = on ? cur.filter((x) => x !== a) : [...cur, a];
                          if (next.length) patchObject(sel.id, { actions: next.length === availableActions.length ? undefined : (next as ObjectAction[]) });
                        };
                        return (
                          <label key={a} className="flex items-center gap-1.5 text-sm">
                            <input type="checkbox" checked={on} onChange={toggle} className="size-4" data-object-action={a} />
                            {t(`objects.actions.${a}`)}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                )}
                {/* Linked character / scene */}
                {cast.length > 0 && (
                  <label className="flex flex-col gap-1">
                    <span className="font-label text-[10px] uppercase text-label">{sel.type === "counter" ? t("playArea.keeper") : t("playArea.linkedNpc")}</span>
                    <select
                      value={(sel.type === "counter" ? sel.keeper : sel.npc) ?? ""}
                      onChange={(e) => patchObject(sel.id, sel.type === "counter" ? { keeper: e.target.value || null } : { npc: e.target.value || null })}
                      className="px-input min-h-11 px-2"
                      data-object-keeper
                    >
                      <option value="">{sel.type === "counter" ? t("playArea.keeperAuto") : t("playArea.linkedNone")}</option>
                      {cast.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {scenes.length > 1 && (
                  <label className="flex flex-col gap-1">
                    <span className="font-label text-[10px] uppercase text-label">{t("playArea.linkedScene")}</span>
                    <select value={sel.linkedScene ?? ""} onChange={(e) => patchObject(sel.id, { linkedScene: e.target.value || null })} className="px-input min-h-11 px-2" data-object-scene>
                      <option value="">{t("playArea.linkedNone")}</option>
                      {scenes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {/* Explorable world: how this object behaves when used. */}
                {(EXIT_TYPES.includes(sel.type) || sel.type === "exit") && (
                  <label className="flex items-center gap-2 text-base">
                    <input type="checkbox" checked={sel.exit ?? EXIT_TYPES.includes(sel.type)} onChange={(e) => patchObject(sel.id, { exit: e.target.checked })} className="size-5" data-object-exit />
                    {t("playArea.exitField")}
                  </label>
                )}
                {(sel.type === "door" || sel.type === "chest") && (
                  <>
                    <label className="flex items-center gap-2 text-base">
                      <input type="checkbox" checked={!!sel.startsOpen} onChange={(e) => patchObject(sel.id, { startsOpen: e.target.checked, locked: e.target.checked ? false : sel.locked })} className="size-5" />
                      {t("playArea.startsOpen")}
                    </label>
                    <label className="flex items-center gap-2 text-base">
                      <input type="checkbox" checked={!!sel.locked} onChange={(e) => patchObject(sel.id, { locked: e.target.checked, startsOpen: e.target.checked ? false : sel.startsOpen })} className="size-5" data-object-locked />
                      {t("playArea.locked")}
                    </label>
                    {sel.locked && (
                      <label className="flex flex-col gap-1">
                        <span className="font-label text-[10px] uppercase text-label">{t("playArea.keyName")}</span>
                        <input value={sel.keyName ?? ""} maxLength={30} placeholder={t("playArea.keyNamePlaceholder")} onChange={(e) => patchObject(sel.id, { keyName: e.target.value })} className="px-input min-h-11 px-2" />
                      </label>
                    )}
                  </>
                )}
                {sel.type === "chest" && (
                  <label className="flex flex-col gap-1">
                    <span className="font-label text-[10px] uppercase text-label">{t("playArea.contents")}</span>
                    <input
                      value={(sel.contents ?? []).join(", ")}
                      maxLength={200}
                      placeholder={t("playArea.contentsPlaceholder")}
                      onChange={(e) => patchObject(sel.id, { contents: e.target.value.split(/[,，、]/).map((x) => x.trim()).filter(Boolean) })}
                      className="px-input min-h-11 px-2"
                    />
                  </label>
                )}
                {(sel.type === "sign" || sel.type === "book" || sel.type === "painting" || sel.type === "feature" || sel.type === "item" || sel.type === "window") && (
                  <label className="flex flex-col gap-1">
                    <span className="font-label text-[10px] uppercase text-label">{t("playArea.note")}</span>
                    <input value={sel.note ?? ""} maxLength={280} placeholder={t("playArea.notePlaceholder")} onChange={(e) => patchObject(sel.id, { note: e.target.value })} className="px-input min-h-11 px-2" data-object-note />
                  </label>
                )}
                {/* Story metadata: what it's about (characters' interests), hidden or not */}
                <label className="flex flex-col gap-1">
                  <span className="font-label text-[10px] uppercase text-label">{t("playArea.interests")}</span>
                  <InterestsInput value={sel.interests ?? []} placeholder={t("playArea.interestsPlaceholder")} onChange={(v) => patchObject(sel.id, { interests: v.length ? v : undefined })} />
                  <span className="text-xs text-ink-mute">{t("playArea.interestsHint")}</span>
                </label>
                <label className="flex items-center gap-2 text-base">
                  <input type="checkbox" checked={!!sel.hidden} onChange={(e) => patchObject(sel.id, { hidden: e.target.checked || undefined })} className="size-5" data-object-hidden />
                  {t("playArea.hiddenObject")}
                </label>
                {/* Ambient animation */}
                <label className="flex flex-col gap-1">
                  <span className="font-label text-[10px] uppercase text-label">{t("playArea.ambient")}</span>
                  <select
                    value={ambientValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      patchObject(sel.id, { ambient: v === "auto" ? undefined : v === "none" ? null : ambientSpec(v as AmbientKind, { speed: sel.ambient?.speed ?? 1, phase: sel.ambient?.phase ?? Math.random() }) });
                    }}
                    className="px-input min-h-11 px-2"
                    data-object-ambient
                  >
                    <option value="auto">
                      {t("playArea.ambientAuto")}
                      {autoAmbient ? ` (${t(`playArea.ambientKinds.${autoAmbient.kind}`)})` : ` (${t("playArea.ambientNone")})`}
                    </option>
                    <option value="none">{t("playArea.ambientNone")}</option>
                    {AMBIENT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`playArea.ambientKinds.${k}`)}
                      </option>
                    ))}
                  </select>
                </label>
                {sel.ambient && sel.ambient.enabled && (
                  <label className="flex flex-col gap-1">
                    <span className="flex justify-between font-label text-[10px] uppercase text-label">
                      {t("playArea.ambientSpeed")}
                      <span className="tabular-nums text-ink-soft">{sel.ambient.speed.toFixed(1)}×</span>
                    </span>
                    <input type="range" min={0.5} max={2} step={0.1} value={sel.ambient.speed} onChange={(e) => patchObject(sel.id, { ambient: { ...sel.ambient!, speed: Number(e.target.value) } })} className="px-range" style={{ "--fill": `${((sel.ambient.speed - 0.5) / 1.5) * 100}%` } as CSSProperties} />
                  </label>
                )}
                {unreachable.has(sel.id) && <p className="text-sm text-coral-deep">{t("playArea.unreachable")}</p>}
                <PixelButton
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  onClick={() => {
                    commitLayout((l) => ({ ...l, objects: l.objects.filter((o) => o.id !== sel.id) }));
                    setSelected(null);
                  }}
                >
                  {t("playArea.deleteObject")}
                </PixelButton>
              </div>
            )}
            <p className="text-sm text-ink-mute">{t("playArea.spawnCount", { n: String(layout.spawns.length) })}</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Comma-separated words, edited as text and stored as a clean list (typing a comma never loses it). */
function InterestsInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [text, setText] = useState(value.join(", "));
  const joined = value.join(", ");
  useEffect(() => {
    setText((cur) => (cur.split(/[,，、]/).map((x) => x.trim()).filter(Boolean).join(", ") === joined ? cur : joined));
  }, [joined]);
  return (
    <input
      value={text}
      maxLength={240}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split(/[,，、]/).map((x) => x.trim()).filter(Boolean).slice(0, 12));
      }}
      className="px-input min-h-11 px-2"
      data-object-interests
    />
  );
}
