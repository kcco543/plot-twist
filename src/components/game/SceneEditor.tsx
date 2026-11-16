"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { useI18n } from "@/i18n";
import { makeId } from "@/lib/id";
import { updateMapDetails, type GeneratedMap } from "@/lib/mapGenerator";
import { mapDisplayName } from "@/lib/scene/useScene";
import {
  STAGE_WIDTHS,
  SCENE_OBJECT_TYPES,
  buildScene,
  defaultLayout,
  floorShare,
  footprintOf,
  guessFloor,
  paintStroke,
  readLayout,
  type CharacterSize,
  type Perspective,
  type SceneLayout,
  type SceneObject,
} from "@/lib/scene/layout";
import type { Point, Rect } from "@/lib/stage/room";
import { EXIT_TYPES, type ObjectType } from "@/lib/stage/objects";

type Tool = "floor" | "wall" | "object" | "spawn";
const BRUSHES = { s: 1, m: 2, l: 4 } as const;
type Brush = keyof typeof BRUSHES;
const MIN_OBJECT = 0.015;
const SPAWN_HIT = 0.03;

const pct = (v: number) => `${v * 100}%`;
const sizeOf = (w: number): CharacterSize => (Object.entries(STAGE_WIDTHS).reduce((best, [k, v]) => (Math.abs(v - w) < Math.abs(STAGE_WIDTHS[best] - w) ? (k as CharacterSize) : best), "medium" as CharacterSize));

/**
 * PLAY AREA EDITOR — the navigation layer of a generated map.
 * The picture can't tell the game where the floor or the furniture is, so the
 * player paints it: floor / wall brushes for where characters may walk,
 * rectangles for objects (solid furniture blocks walking and can hide people
 * behind it; every object is something characters can be dragged to and use),
 * and spawn points. Saved with the map, so every save using it plays the same.
 */
export function SceneEditor({ open, map, onClose, onSaved, cast = [] }: { open: boolean; map: GeneratedMap; onClose: () => void; onSaved?: () => void; cast?: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const [layout, setLayout] = useState<SceneLayout>(() => readLayout(map.scene, map.width, map.height));
  const [name, setName] = useState(() => mapDisplayName(map));
  const [tool, setTool] = useState<Tool>("floor");
  const [brush, setBrush] = useState<Brush>("m");
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState<Rect | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [focusName, setFocusName] = useState(0);
  // A new object: type its name straight away, without scrolling the picture out of view.
  useEffect(() => {
    if (focusName) nameRef.current?.focus({ preventScroll: true });
  }, [focusName]);
  const gesture = useRef<{ kind: "paint"; last: Point } | { kind: "rect"; start: Point } | null>(null);

  // Start from what's stored each time the editor opens (Cancel throws the changes away).
  useEffect(() => {
    if (!open) return;
    setLayout(readLayout(map.scene, map.width, map.height));
    setName(mapDisplayName(map));
    setSelected(null);
    setError(false);
  }, [open, map]);

  const built = useMemo(() => buildScene(layout, map.width, map.height, map.type), [layout, map.width, map.height, map.type]);
  const unreachable = new Set(built.problems.map((p) => p.objectId));
  const share = floorShare(layout.floor);
  const sel = layout.objects.find((o) => o.id === selected) ?? null;
  const stageH = built.size.height;

  const frac = (e: { clientX: number; clientY: number }): Point => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const cell = (p: Point): Point => ({ x: p.x * layout.cols - 0.5, y: p.y * layout.rows - 0.5 });
  const patch = (p: Partial<SceneLayout>) => setLayout((l) => ({ ...l, ...p }));
  const patchObject = (id: string, p: Partial<SceneObject>) => setLayout((l) => ({ ...l, objects: l.objects.map((o) => (o.id === id ? { ...o, ...p } : o)) }));

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const p = frac(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    if (tool === "floor" || tool === "wall") {
      const c = cell(p);
      setLayout((l) => ({ ...l, floor: paintStroke(l, c, c, BRUSHES[brush], tool === "floor") }));
      gesture.current = { kind: "paint", last: c };
    } else if (tool === "object") {
      const hit = [...layout.objects].reverse().find((o) => p.x >= o.bounds.x0 && p.x <= o.bounds.x1 && p.y >= o.bounds.y0 && p.y <= o.bounds.y1);
      if (hit) {
        setSelected(hit.id);
        gesture.current = null;
        return;
      }
      gesture.current = { kind: "rect", start: p };
      setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    } else if (tool === "spawn") {
      const near = layout.spawns.findIndex((s) => Math.hypot(s.x - p.x, s.y - p.y) < SPAWN_HIT);
      if (near >= 0) patch({ spawns: layout.spawns.filter((_, i) => i !== near) });
      else if (layout.spawns.length < 12) patch({ spawns: [...layout.spawns, p] });
      gesture.current = null;
    }
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const p = frac(e);
    if (g.kind === "paint") {
      const c = cell(p);
      const from = g.last;
      setLayout((l) => ({ ...l, floor: paintStroke(l, from, c, BRUSHES[brush], tool === "floor") }));
      g.last = c;
    } else setDraft({ x0: Math.min(g.start.x, p.x), y0: Math.min(g.start.y, p.y), x1: Math.max(g.start.x, p.x), y1: Math.max(g.start.y, p.y) });
  };
  const onUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind === "rect" && draft) {
      if (draft.x1 - draft.x0 >= MIN_OBJECT && draft.y1 - draft.y0 >= MIN_OBJECT) {
        const o: SceneObject = { id: makeId("obj"), label: "", type: "feature", bounds: draft, solid: true, front: true };
        setLayout((l) => ({ ...l, objects: [...l.objects, o] }));
        setSelected(o.id);
        setFocusName((n) => n + 1);
      }
      setDraft(null);
    }
  };

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

  const toolButton = (k: Tool, icon: "drop" | "eraser" | "plus" | "user") => (
    <PixelButton key={k} size="sm" variant={tool === k ? "accent" : "ghost"} icon={icon} aria-pressed={tool === k} onClick={() => setTool(k)} data-tool={k}>
      {t(`playArea.tools.${k}`)}
    </PixelButton>
  );

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
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]" data-scene-editor>
        <div className="flex min-w-0 flex-col gap-3">
        <p className="hidden text-base leading-snug text-ink-soft sm:block">{t("playArea.intro")}</p>

        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t("playArea.toolsLabel")}>
          {toolButton("floor", "drop")}
          {toolButton("wall", "eraser")}
          {toolButton("object", "plus")}
          {toolButton("spawn", "user")}
          {(tool === "floor" || tool === "wall") && (
            <span className="flex items-center gap-1">
              <span className="font-label text-[10px] uppercase text-ink-mute">{t("playArea.brush")}</span>
              {(Object.keys(BRUSHES) as Brush[]).map((b) => (
                <PixelButton key={b} size="sm" variant={brush === b ? "accent" : "ghost"} aria-pressed={brush === b} onClick={() => setBrush(b)} className="min-w-11 px-1">
                  {t(`playArea.brushes.${b}`)}
                </PixelButton>
              ))}
            </span>
          )}
        </div>
        <p className="text-sm text-ink-mute">{t(`playArea.hints.${tool}`)}</p>

        {/* The picture with the navigation layer on top. Same aspect ratio as the map, never stretched. */}
        <div
          ref={box}
          data-scene-canvas
          className="relative mx-auto w-full touch-none select-none overflow-hidden shadow-[0_0_0_2px_var(--color-line)]"
          // Never taller than ~60% of the screen, so the whole picture stays in view while painting.
          style={{ aspectRatio: `${map.width} / ${map.height}`, maxWidth: `calc(60dvh * ${map.width / map.height})`, cursor: tool === "object" ? "crosshair" : tool === "spawn" ? "copy" : "cell" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- generated blob */}
          <img src={map.url} alt={name} draggable={false} className="absolute inset-0 block size-full" />
          <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${layout.cols} ${layout.rows}`} preserveAspectRatio="none" aria-hidden>
            <path d={floorPath} fill="rgb(120 220 170 / 0.38)" stroke="none" />
          </svg>
          {layout.objects.map((o) => {
            const foot = o.solid ? footprintOf(o.bounds, layout.perspective) : null;
            const bad = unreachable.has(o.id);
            return (
              <span key={o.id} className="pointer-events-none absolute inset-0">
                {foot && <span className="absolute bg-coral-deep/35" style={{ left: pct(foot.x0), top: pct(foot.y0), width: pct(foot.x1 - foot.x0), height: pct(foot.y1 - foot.y0) }} />}
                <span
                  data-scene-object={o.id}
                  className="absolute"
                  style={{
                    left: pct(o.bounds.x0),
                    top: pct(o.bounds.y0),
                    width: pct(o.bounds.x1 - o.bounds.x0),
                    height: pct(o.bounds.y1 - o.bounds.y0),
                    border: `2px ${o.id === selected ? "solid" : "dashed"} ${bad ? "var(--color-coral-deep)" : o.id === selected ? "var(--color-butter-lo)" : "white"}`,
                    boxShadow: "0 0 0 1px rgb(0 0 0 / 0.35)",
                  }}
                >
                  <span className="absolute left-0 top-0 max-w-full truncate bg-white/90 px-1 text-[11px] leading-tight text-ink">{o.label || t(`playArea.types.${o.type}`)}</span>
                </span>
              </span>
            );
          })}
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

        </div>

        <div className="grid content-start gap-4 md:grid-cols-2 lg:grid-cols-1">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-label text-xs uppercase tracking-wide text-label">{t("playArea.name")}</span>
              <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="px-input min-h-11 px-2 text-lg" data-scene-name />
            </label>
            <div className="flex flex-col gap-1">
              <span className="font-label text-xs uppercase tracking-wide text-label">{t("playArea.perspective")}</span>
              <div className="flex flex-wrap gap-2">
                {(["angled", "side"] as Perspective[]).map((p) => (
                  <PixelButton key={p} size="sm" variant={layout.perspective === p ? "accent" : "ghost"} aria-pressed={layout.perspective === p} onClick={() => patch({ perspective: p })}>
                    {t(`playArea.perspectives.${p}`)}
                  </PixelButton>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-label text-xs uppercase tracking-wide text-label">{t("playArea.characterSize")}</span>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(STAGE_WIDTHS) as CharacterSize[]).map((k) => (
                  <PixelButton key={k} size="sm" variant={sizeOf(layout.stageWidth) === k ? "accent" : "ghost"} aria-pressed={sizeOf(layout.stageWidth) === k} onClick={() => patch({ stageWidth: STAGE_WIDTHS[k] })}>
                    {t(`playArea.sizes.${k}`)}
                  </PixelButton>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-label text-xs uppercase tracking-wide text-label">
                {t("playArea.floor")} · {Math.round(share * 100)}%
              </span>
              <div className="flex flex-wrap gap-2">
                <PixelButton size="sm" variant="ghost" icon="undo" onClick={() => patch({ floor: guessFloor(layout.cols, layout.rows, layout.perspective) })}>
                  {t("playArea.resetGuess")}
                </PixelButton>
                <PixelButton size="sm" variant="ghost" onClick={() => patch({ floor: "1".repeat(layout.cols * layout.rows) })}>
                  {t("playArea.fillAll")}
                </PixelButton>
                <PixelButton size="sm" variant="ghost" icon="trash" onClick={() => patch({ floor: "0".repeat(layout.cols * layout.rows) })}>
                  {t("playArea.clearAll")}
                </PixelButton>
                <PixelButton size="sm" variant="ghost" icon="trash" onClick={() => setLayout({ ...defaultLayout(map.width, map.height, layout.perspective), stageWidth: layout.stageWidth })}>
                  {t("playArea.startOver")}
                </PixelButton>
              </div>
              {share < 0.02 && <p className="text-sm text-coral-deep">{t("playArea.noFloor")}</p>}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <span className="font-label text-xs uppercase tracking-wide text-label">
              {t("playArea.objects")} · {layout.objects.length}
            </span>
            {layout.objects.length === 0 && <p className="text-sm text-ink-mute">{t("playArea.noObjects")}</p>}
            <ul className="flex flex-wrap gap-1.5">
              {layout.objects.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(o.id);
                      setTool("object");
                    }}
                    aria-pressed={o.id === selected}
                    className={`px-focus flex items-center gap-1 px-2 py-1 text-sm ${o.id === selected ? "bg-butter" : "bg-well"} ${unreachable.has(o.id) ? "text-coral-deep" : "text-ink"}`}
                  >
                    {unreachable.has(o.id) && <PixelIcon name="close" size={8} />}
                    {o.label || t(`playArea.types.${o.type}`)}
                  </button>
                </li>
              ))}
            </ul>
            {sel && (
              <div className="flex flex-col gap-2 bg-well p-2" data-scene-object-editor>
                <label className="flex flex-col gap-1">
                  <span className="font-label text-[10px] uppercase text-label">{t("playArea.objectName")}</span>
                  <input ref={nameRef} value={sel.label} maxLength={40} placeholder={t("playArea.objectNamePlaceholder")} onChange={(e) => patchObject(sel.id, { label: e.target.value })} className="px-input min-h-11 px-2" data-scene-object-name />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-label text-[10px] uppercase text-label">{t("playArea.objectType")}</span>
                  <select value={sel.type} onChange={(e) => patchObject(sel.id, { type: e.target.value as ObjectType })} className="px-input min-h-11 px-2">
                    {SCENE_OBJECT_TYPES.map((k) => (
                      <option key={k} value={k}>
                        {t(`playArea.types.${k}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-base">
                  <input type="checkbox" checked={sel.solid} onChange={(e) => patchObject(sel.id, { solid: e.target.checked, front: e.target.checked ? sel.front : false })} className="size-5" />
                  {t("playArea.solid")}
                </label>
                <label className={`flex items-center gap-2 text-base ${sel.solid ? "" : "opacity-50"}`}>
                  <input type="checkbox" disabled={!sel.solid} checked={sel.front} onChange={(e) => patchObject(sel.id, { front: e.target.checked })} className="size-5" />
                  {t("playArea.front")}
                </label>
                {/* Explorable world: how this object behaves when used. */}
                {(EXIT_TYPES.includes(sel.type) || sel.type === "exit") && (
                  <label className="flex items-center gap-2 text-base">
                    <input type="checkbox" checked={sel.exit ?? EXIT_TYPES.includes(sel.type)} onChange={(e) => patchObject(sel.id, { exit: e.target.checked })} className="size-5" data-object-exit />
                    {t("playArea.exitField")}
                  </label>
                )}
                {sel.type === "counter" && (
                  <label className="flex flex-col gap-1">
                    <span className="font-label text-[10px] uppercase text-label">{t("playArea.keeper")}</span>
                    <select value={sel.keeper ?? ""} onChange={(e) => patchObject(sel.id, { keeper: e.target.value || null })} className="px-input min-h-11 px-2" data-object-keeper>
                      <option value="">{t("playArea.keeperAuto")}</option>
                      {cast.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
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
                {unreachable.has(sel.id) && <p className="text-sm text-coral-deep">{t("playArea.unreachable")}</p>}
                <PixelButton
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  onClick={() => {
                    setLayout((l) => ({ ...l, objects: l.objects.filter((o) => o.id !== sel.id) }));
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
