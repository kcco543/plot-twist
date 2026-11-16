"use client";

/**
 * WORLD VIEWPORT — Play Mode's game screen with a following camera.
 * --------------------------------------------------------------------------
 * A fixed-size window onto the stage. The stage is drawn at a readable,
 * whole-device-pixel zoom (camera.ts: wide / normal / close) instead of being
 * shrunk to fit, and the camera glides after the focused character (selected
 * or speaking) with a small dead zone, stopping at the map's edges. Maps
 * smaller than the window are centred.
 *
 * The camera runs in its own requestAnimationFrame loop and writes one CSS
 * transform, so following never re-renders React. Everything inside (the
 * picture, sprites, effects, collision overlay, name tags, drag preview,
 * bubbles) shares the same world coordinates under that one transform.
 *
 * Input: dragging an empty spot pans the camera by hand (follow pauses; the
 * eye button or selecting / dragging a character resumes it). A tap on an
 * empty spot is reported in WORLD coordinates (`onTap`), so the play screen
 * can hit-test objects correctly at any zoom or pan. While a character is
 * being dragged, holding the pointer near an edge scrolls the view.
 */
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import type { ArtAsset } from "@/assets/manifest";
import { useI18n } from "@/i18n";
import {
  FOLLOW_SPEEDS,
  ZOOMS,
  centreOn,
  clampCamera,
  ease,
  edgePan,
  followTarget,
  screenToWorld,
  translateFor,
  viewportHeight,
  viewSize,
  worldToViewport,
  zoomScales,
  type Camera,
  type FollowSpeed,
  type Zoom,
} from "@/lib/camera/camera";
import type { Point } from "@/lib/stage/room";
import type { StageSim } from "@/lib/stage/sim";
import { StageSizeContext, StageViewContext, type StageView } from "./PixelStage";
import type { DragView } from "./CharacterDrag";
import { PixelIcon } from "@/components/ui/PixelIcon";

const PHONE_MAX = 640;
const PAN_SLOP = 6;

export type ViewportApi = {
  /** Screen (clientX/Y) → world (art px), with the camera as drawn right now. */
  toWorld: (clientX: number, clientY: number) => Point | null;
  /** World → screen (clientX/Y). */
  toScreen: (p: Point) => Point | null;
  camera: () => Camera | null;
  recenter: () => void;
  following: () => boolean;
};

export function WorldViewport({
  apiRef,
  art,
  imageWidth,
  label,
  frame = "panel",
  tag,
  children,
  overlay,
  stage,
  focusId,
  zoom,
  onZoom,
  followSpeed = "normal",
  reducedMotion,
  maxHeight,
  drag,
  onDragScroll,
  onTap,
  locked = false,
  sceneKey,
}: {
  apiRef?: Ref<ViewportApi>;
  art: ArtAsset;
  /** Real width of a generated picture (px), to choose crisp vs smooth image scaling. */
  imageWidth?: number;
  label: string;
  frame?: string;
  tag?: string;
  children?: ReactNode;
  overlay?: ReactNode;
  stage: StageSim;
  /** The character the camera follows (selected / speaking). */
  focusId: string | null;
  zoom: Zoom;
  onZoom: (z: Zoom) => void;
  followSpeed?: FollowSpeed;
  reducedMotion: boolean;
  /** Desktop: tallest the viewport may be (CSS px). Phones use a near-square view. */
  maxHeight?: number;
  /** The character drag in progress (edge scrolling, and the camera holds still). */
  drag?: { get: () => DragView };
  /** The camera scrolled under a held drag: re-aim the drag preview. */
  onDragScroll?: () => void;
  /** Tap / click on an empty spot of the map (world px). */
  onTap?: (p: Point, client: Point) => void;
  /** No manual panning or taps (modal open, scene transition). */
  locked?: boolean;
  /** Changes when the scene changes: the camera jumps to the focus instead of gliding across. */
  sceneKey: string;
}) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const worldEl = useRef<HTMLDivElement>(null);
  const imgEl = useRef<HTMLImageElement>(null);
  const [boxW, setBoxW] = useState(0);
  const [dpr, setDpr] = useState(1);
  const world = useMemo(() => ({ width: art.width, height: art.height }), [art.width, art.height]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      setBoxW(Math.round(e.contentRect.width));
      setDpr(Math.max(1, window.devicePixelRatio || 1));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const phone = boxW > 0 && boxW < PHONE_MAX;
  const maxH = phone ? Math.round(boxW * 0.92) : Math.round(Math.min(maxHeight ?? boxW * 0.62, boxW * 0.75));
  const scales = useMemo(() => (boxW ? zoomScales(world, { width: boxW, height: maxH }, phone, dpr) : null), [boxW, maxH, phone, dpr, world]);
  const scale = scales ? scales[zoom] : 0;
  const viewH = scale ? viewportHeight(world, scale, maxH) : 0;
  const cam = useRef<Camera>({ x: 0, y: 0, scale: 1, viewW: 1, viewH: 1 });
  const follow = useRef(true);
  const recentering = useRef(true);
  const snapNext = useRef(true);
  const [following, setFollowing] = useState(true);
  const [view, setView] = useState<StageView>(null);
  const lastView = useRef<{ x: number; y: number } | null>(null);
  const deps = useRef({ stage, focusId, drag, onDragScroll, reducedMotion, followSpeed, world, dpr });
  deps.current = { stage, focusId, drag, onDragScroll, reducedMotion, followSpeed, world, dpr };

  const focusPoint = useCallback((): Point | null => {
    const { stage: s, focusId: id } = deps.current;
    const p = id ? s.position(id) : null;
    // Aim at the middle of the body, not the feet.
    return p ? { x: p.x, y: p.y - 14 } : null;
  }, []);

  const apply = useCallback(() => {
    const el = worldEl.current;
    if (!el) return;
    const c = cam.current;
    const tr = translateFor(c, deps.current.dpr);
    el.style.transform = `translate3d(${tr.x}px, ${tr.y}px, 0)`;
    // The bubble needs to know what's on screen (coarse steps only: it re-renders React).
    const v = viewSize(c);
    const offX = Math.max(0, -tr.x);
    const offY = Math.max(0, -tr.y);
    const lv = lastView.current;
    if (!lv || Math.abs(lv.x - offX) > 24 || Math.abs(lv.y - offY) > 24) {
      lastView.current = { x: offX, y: offY };
      const ww = deps.current.world.width * c.scale;
      const wh = deps.current.world.height * c.scale;
      setView({ offsetX: offX, viewW: Math.min(ww, v.width * c.scale), offsetY: offY, viewH: Math.min(wh, v.height * c.scale) });
    }
  }, []);

  // New size / zoom: keep the same world point in the middle of the view.
  useLayoutEffect(() => {
    if (!scale || !boxW) return;
    const old = cam.current;
    const v0 = viewSize(old);
    const mid = { x: old.x + v0.width / 2, y: old.y + v0.height / 2 };
    const next: Camera = { ...old, scale, viewW: boxW, viewH };
    const f = focusPoint();
    const target = snapNext.current && f ? centreOn(f, next) : centreOn(mid, next);
    const p = clampCamera(target.x, target.y, next, world);
    cam.current = { ...next, ...p };
    snapNext.current = false;
    lastView.current = null;
    apply();
  }, [scale, boxW, viewH, world, apply, focusPoint]);

  // Different scene: jump straight to the focused character, following again.
  useEffect(() => {
    snapNext.current = true;
    follow.current = true;
    recentering.current = false;
    setFollowing(true);
    const f = focusPoint();
    if (f && cam.current.scale) {
      const c0 = centreOn(f, cam.current);
      const p = clampCamera(c0.x, c0.y, cam.current, deps.current.world);
      cam.current = { ...cam.current, ...p };
      lastView.current = null;
      apply();
    }
  }, [sceneKey, focusPoint, apply]);

  // A different character to follow: glide over to them (and follow again after a manual pan).
  useEffect(() => {
    recentering.current = true;
    follow.current = true;
    setFollowing(true);
  }, [focusId]);

  // The camera loop.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let dragPanned = false;
    const loop = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const c = cam.current;
      const d = deps.current;
      if (c.scale > 0) {
        let pos: Point = { x: c.x, y: c.y };
        const dv = d.drag?.get() ?? null;
        if (dv) {
          // Dragging a character: hold still, but scroll when the pointer rests near an edge.
          const vp = worldToViewport(dv.point, c, d.dpr);
          const v = edgePan(vp, c);
          if (v.x || v.y) {
            pos = { x: c.x + (v.x * dt) / 1000, y: c.y + (v.y * dt) / 1000 };
            dragPanned = true;
          }
        } else if (dragPanned) {
          // The drop is a command: follow the character again (gently, with the dead zone, from where the drag left the view).
          dragPanned = false;
          follow.current = true;
          recentering.current = false;
          setFollowingSoon(true);
        } else if (follow.current) {
          const f = focusPoint();
          if (f) {
            const target = recentering.current ? centreOn(f, c) : followTarget(c, f, c);
            const clamped = clampCamera(target.x, target.y, c, d.world);
            pos = ease(c, clamped, dt, d.reducedMotion ? 0 : FOLLOW_SPEEDS[d.followSpeed]);
            if (recentering.current && Math.abs(pos.x - clamped.x) < 0.5 && Math.abs(pos.y - clamped.y) < 0.5) recentering.current = false;
          }
        }
        const p = clampCamera(pos.x, pos.y, c, d.world);
        if (p.x !== c.x || p.y !== c.y) {
          cam.current = { ...c, ...p };
          apply();
          if (dv) d.onDragScroll?.();
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [apply, focusPoint]);

  // setState from inside the loop only when it actually changes.
  const followingRef = useRef(true);
  const setFollowingSoon = (v: boolean) => {
    if (followingRef.current === v) return;
    followingRef.current = v;
    setFollowing(v);
  };
  useEffect(() => {
    followingRef.current = following;
  }, [following]);

  const recenter = useCallback(() => {
    follow.current = true;
    recentering.current = true;
    setFollowing(true);
  }, []);

  useImperativeHandle(
    apiRef,
    () => ({
      toWorld: (x, y) => {
        const el = box.current;
        if (!el || !cam.current.scale) return null;
        return screenToWorld({ x, y }, el.getBoundingClientRect(), cam.current, deps.current.dpr);
      },
      toScreen: (p) => {
        const el = box.current;
        if (!el || !cam.current.scale) return null;
        const r = el.getBoundingClientRect();
        const v = worldToViewport(p, cam.current, deps.current.dpr);
        return { x: v.x + r.left, y: v.y + r.top };
      },
      camera: () => (cam.current.scale ? { ...cam.current } : null),
      recenter,
      following: () => follow.current,
    }),
    [recenter],
  );

  // ---- manual panning and taps on empty ground
  const gesture = useRef<{ id: number; x0: number; y0: number; cx: number; cy: number; panning: boolean } | null>(null);
  const v = scale ? viewSize({ viewW: boxW, viewH, scale }) : null;
  const canPan = !!v && (world.width > v.width + 0.5 || world.height > v.height + 0.5);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (locked || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    const target = e.target as Element;
    if (target.closest("[data-actor], [data-speech-bubble], [data-camera-controls], button, a, input, textarea, select, [role=menu]")) return;
    gesture.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, cx: cam.current.x, cy: cam.current.y, panning: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.panning) {
      if (!canPan || Math.hypot(dx, dy) < PAN_SLOP) return;
      g.panning = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      follow.current = false;
      setFollowingSoon(false);
    }
    const c = cam.current;
    const p = clampCamera(g.cx - dx / c.scale, g.cy - dy / c.scale, c, world);
    cam.current = { ...c, ...p };
    apply();
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (g.panning || locked) return;
    const el = box.current;
    if (!el || !onTap) return;
    const p = screenToWorld({ x: e.clientX, y: e.clientY }, el.getBoundingClientRect(), cam.current, dpr);
    if (p.x >= 0 && p.y >= 0 && p.x <= world.width && p.y <= world.height) onTap(p, { x: e.clientX, y: e.clientY });
  };

  // Generated pictures: crisp (nearest-neighbour) when enlarged, smooth when shrunk.
  const upscaled = !art.smooth || !imageWidth || (scale * dpr * art.width) / imageWidth >= 0.999;
  const w = art.width * scale;
  const h = art.height * scale;
  const zi = ZOOMS.indexOf(zoom);

  return (
    <div className="px-frame px-shadow" style={{ "--frame": `var(--frame-${frame})` } as CSSProperties}>
      <div
        ref={box}
        data-stage-view
        data-camera-zoom={zoom}
        data-camera-scale={scale || undefined}
        className="px-checker relative w-full overflow-hidden"
        style={{ height: viewH || undefined, aspectRatio: viewH ? undefined : `${art.width} / ${art.height}`, touchAction: canPan ? "none" : "pan-y", cursor: canPan && !locked ? "grab" : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (gesture.current = null)}
      >
        {scale > 0 && (
          <StageViewContext.Provider value={view}>
            <StageSizeContext.Provider value={world}>
              <div ref={worldEl} data-camera-world className="absolute left-0 top-0 will-change-transform" style={{ width: w, height: h }}>
                <div className="absolute left-0 top-0 origin-top-left" style={{ width: art.width, height: art.height, transform: `scale(${scale})` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img ref={imgEl} src={art.src} alt={label} width={art.width} height={art.height} draggable={false} data-stage-art={art.smooth ? "generated" : "builtin"} className={`${upscaled ? "pixelated " : ""}absolute inset-0 block size-full select-none`} />
                  {children}
                </div>
                {overlay && <div className="pointer-events-none absolute inset-0">{overlay}</div>}
              </div>
            </StageSizeContext.Provider>
          </StageViewContext.Provider>
        )}
        {scale > 0 && tag && art.placeholder && <span className="pointer-events-none absolute left-1 top-1 bg-white/90 px-1.5 py-0.5 font-label text-[9px] uppercase leading-none text-ink-soft">{tag}</span>}
        {scale > 0 && (
          <div data-camera-controls className="absolute bottom-1.5 right-1.5 z-40 flex items-stretch gap-1" role="group" aria-label={t("camera.controls")}>
            {!following && (
              <button type="button" onClick={recenter} className="px-focus flex min-h-9 items-center gap-1 bg-butter px-2 font-label text-[10px] uppercase text-ink shadow-[inset_0_-3px_0_var(--color-butter-lo)]" data-camera-follow>
                <PixelIcon name="eye" size={12} />
                <span>{t("camera.follow")}</span>
              </button>
            )}
            <div className="flex items-stretch bg-white/90 shadow-[inset_0_-3px_0_rgb(0_0_0/0.12)]">
              <button type="button" disabled={zi <= 0} onClick={() => onZoom(ZOOMS[Math.max(0, zi - 1)])} aria-label={t("camera.zoomOut")} className="px-focus grid min-h-9 min-w-9 place-items-center text-ink disabled:opacity-35" data-camera-zoom-out>
                <PixelIcon name="minus" size={12} />
              </button>
              <span className="grid min-w-14 place-items-center px-1 font-label text-[10px] uppercase text-ink-soft" aria-live="polite" data-camera-zoom-label>
                {t(`camera.zooms.${zoom}`)}
              </span>
              <button type="button" disabled={zi >= ZOOMS.length - 1} onClick={() => onZoom(ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)])} aria-label={t("camera.zoomIn")} className="px-focus grid min-h-9 min-w-9 place-items-center text-ink disabled:opacity-35" data-camera-zoom-in>
                <PixelIcon name="plus" size={12} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
