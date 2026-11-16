import { describe, expect, it } from "vitest";
import { clampCamera, centreOn, ease, edgePan, followTarget, inView, screenToWorld, snapScale, translateFor, worldToTile, worldToViewport, viewportToWorld, zoomScales, type Camera } from "@/lib/camera/camera";

const big = { width: 1536, height: 1024 }; // a generated map
const small = { width: 320, height: 180 }; // a built-in room

describe("camera", () => {
  it("zoom levels: readable on a big map instead of shrinking it to fit", () => {
    const z = zoomScales(big, { width: 1200, height: 700 }, false, 1);
    // Fitting would be < 1×; normal stays readable, and wide never goes below a readable minimum.
    expect(z.normal).toBe(3);
    expect(z.close).toBeGreaterThan(z.normal);
    expect(z.wide).toBeLessThan(z.normal);
    expect(z.wide).toBeGreaterThanOrEqual(1.75);
    const phone = zoomScales(big, { width: 390, height: 360 }, true, 3);
    expect(phone.normal).toBeCloseTo(1.6667, 3); // 5 device px per art px at dpr 3
  });

  it("scales snap to whole device pixels (crisp pixel art)", () => {
    expect(snapScale(2.4, 1)).toBe(2);
    expect(snapScale(1.7, 2)).toBe(1.5);
    expect(snapScale(0.1, 1)).toBe(1);
  });

  it("small maps are centred; big maps clamp at the edges", () => {
    const c = { viewW: 1200, viewH: 700, scale: 3 };
    expect(clampCamera(-500, -500, c, big)).toEqual({ x: 0, y: 0 });
    const end = clampCamera(99999, 99999, c, big);
    expect(end.x).toBeCloseTo(1536 - 400);
    expect(end.y).toBeCloseTo(1024 - 700 / 3);
    const centred = clampCamera(50, 50, { viewW: 1200, viewH: 700, scale: 2 }, small);
    expect(centred.x).toBeCloseTo(-(600 - 320) / 2);
    expect(centred.y).toBeCloseTo(-(350 - 180) / 2);
  });

  it("dead zone: small moves don't move the camera, leaving it does", () => {
    const c = { viewW: 1000, viewH: 600, scale: 2 };
    const cam = centreOn({ x: 500, y: 300 }, c);
    expect(followTarget(cam, { x: 520, y: 310 }, c)).toEqual(cam);
    const moved = followTarget(cam, { x: 900, y: 300 }, c);
    expect(moved.x).toBeGreaterThan(cam.x);
    expect(moved.y).toBe(cam.y);
  });

  it("smoothing converges and settles exactly; 0 = jump (reduced motion)", () => {
    let p = { x: 0, y: 0 };
    for (let i = 0; i < 200; i++) p = ease(p, { x: 100, y: 50 }, 16, 180);
    expect(p).toEqual({ x: 100, y: 50 });
    expect(ease({ x: 0, y: 0 }, { x: 9, y: 9 }, 16, 0)).toEqual({ x: 9, y: 9 });
  });

  it("screen ↔ world round-trips with the same rounded translate the screen uses", () => {
    const cam: Camera = { x: 123.37, y: 45.81, scale: 3, viewW: 900, viewH: 600 };
    const t = translateFor(cam, 2);
    expect(Number.isInteger(t.x * 2)).toBe(true);
    const w = { x: 400.25, y: 210.5 };
    const v = worldToViewport(w, cam, 2);
    const back = viewportToWorld(v, cam, 2);
    expect(back.x).toBeCloseTo(w.x, 6);
    expect(back.y).toBeCloseTo(w.y, 6);
    const s = screenToWorld({ x: v.x + 40, y: v.y + 70 }, { left: 40, top: 70 }, cam, 2);
    expect(s.x).toBeCloseTo(w.x, 6);
    expect(worldToTile({ x: 33, y: 17 }, { cw: 8, ch: 8 })).toEqual({ col: 4, row: 2 });
    expect(inView(w, cam)).toBe(true);
    expect(inView({ x: 0, y: 0 }, cam)).toBe(false);
  });

  it("edge panning only near the edges", () => {
    const c = { viewW: 800, viewH: 600, scale: 2 };
    expect(edgePan({ x: 400, y: 300 }, c)).toEqual({ x: 0, y: 0 });
    expect(edgePan({ x: 2, y: 300 }, c).x).toBeLessThan(0);
    expect(edgePan({ x: 400, y: 598 }, c).y).toBeGreaterThan(0);
  });
});
