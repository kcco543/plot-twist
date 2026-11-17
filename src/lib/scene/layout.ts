/**
 * PLAYABLE SCENES FOR GENERATED MAPS (pure, unit-tested)
 * --------------------------------------------------------------------------
 * A generated map is only a picture: the image service tells us nothing about
 * where the floor is or what the furniture is. So every generated map carries
 * a SceneLayout, an explicit navigation layer the player can edit on top of
 * the picture (World Builder → "Play area"). It is stored with the map in the
 * map library, so every save that uses the map gets the same layout.
 *
 * Everything is measured in FRACTIONS of the image (0..1), so the layout
 * means the same thing whatever size the image or the screen is. When the map
 * is played, `buildScene()` turns it into the stage's art-pixel units:
 *
 *   stage width  = `stageWidth` art px (characters are always 32 art px tall,
 *                  so a wider stage = smaller characters on this map)
 *   stage height = stage width × image height ÷ image width (no stretching)
 *
 * Pieces:
 *   floor     a cols × rows grid of walkable cells ("1" = floor), painted with
 *             the floor / wall brushes. Works for any floor shape, including
 *             the diamond floor of an angled (isometric) room.
 *   objects   rectangles the player names (bar counter, fireplace…). Solid ones
 *             block walking (their lower part is the footprint on the floor)
 *             and can be drawn in front of characters who walk behind them.
 *             Every object is a drag target with its own action.
 *   spawns    where characters appear when the map is first played.
 */
import { FOOT, type NavMask, type Obstacle, type Point, type Rect, type RoomLayout } from "../stage/room";
import { nearestFree } from "../stage/path";
import type { EnvironmentTypeId } from "../types";
import { ACTIONS_BY_TYPE, EXIT_TYPES, type ObjectType, type WorldObject } from "../stage/objects";
import { isNativeSize } from "../pixelArt/mapPixels";

export type Perspective = "side" | "angled";

export type SceneObject = {
  id: string;
  /** The player's own name for it ("bar counter", "圣诞树"). */
  label: string;
  type: ObjectType;
  /** Fractions of the image. */
  bounds: Rect;
  /** Blocks walking (the lower part of `bounds` is its footprint on the floor). */
  solid: boolean;
  /** Draw this part of the picture over characters standing behind it. */
  front: boolean;
  // ---- Explorable world (optional; older layouts simply don't have them)
  /** Leads to another area (doors, stairs, exits, portals). Missing = by type (door/stairs/exit/portal yes). */
  exit?: boolean;
  /** Counters: who works here (a character id). Missing = whoever is standing behind it. */
  keeper?: string | null;
  /** Doors / chests that start locked, and the key that opens them ("key", "钥匙"). */
  locked?: boolean;
  keyName?: string;
  /** Doors / chests that start open. */
  startsOpen?: boolean;
  /** What a sign says, what a book is about, what's notable about it (shown when used). */
  note?: string;
  /** Chests: what's inside, comma separated when edited. */
  contents?: string[];
};

export type SceneLayout = {
  v: 1;
  perspective: Perspective;
  /** Width of the stage in art px. Characters are 32 art px, so this sets their size on the map. */
  stageWidth: number;
  cols: number;
  rows: number;
  /** cols × rows characters, "1" where characters may walk. */
  floor: string;
  objects: SceneObject[];
  /** Fractions of the image (feet positions). */
  spawns: Point[];
  /** False until the player has looked at it and saved: the floor is only a first guess. */
  reviewed: boolean;
  updatedAt: number;
};

/** Character size choices: wider stage = smaller characters. */
export const STAGE_WIDTHS = { large: 400, medium: 480, small: 576, tiny: 672 } as const;
export type CharacterSize = keyof typeof STAGE_WIDTHS;
export const DEFAULT_STAGE_WIDTH = STAGE_WIDTHS.medium;
export const GRID_COLS = 96;

export const OBJECT_ACTIONS_BY_TYPE = ACTIONS_BY_TYPE;
/** Types the player can pick for an object (gifts are placed by the game). */
export const SCENE_OBJECT_TYPES: ObjectType[] = ["feature", "seat", "table", "counter", "stairs", "door", "bed", "chest", "book", "window", "painting", "plant", "light", "sign", "item", "exit", "portal"];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function gridFor(mapW: number, mapH: number) {
  const cols = GRID_COLS;
  const rows = Math.max(8, Math.round((GRID_COLS * mapH) / Math.max(1, mapW)));
  return { cols, rows };
}

/**
 * A first guess at the floor, before the player has painted it. We can't see
 * the furniture, so this is deliberately simple and is shown as a guess:
 * angled maps get the middle of the room, side views a band along the bottom.
 */
export function guessFloor(cols: number, rows: number, perspective: Perspective): string {
  const cells: string[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) / cols;
      const y = (r + 0.5) / rows;
      let on: boolean;
      if (perspective === "angled") {
        // A rounded diamond in the middle-lower part of the picture (where an angled room's floor usually is).
        const dx = Math.abs(x - 0.5) / 0.42;
        const dy = Math.abs(y - 0.6) / 0.33;
        on = dx + dy * 0.8 <= 1 && y > 0.3 && y < 0.95;
      } else on = y >= 0.72 && y <= 0.97 && x >= 0.03 && x <= 0.97;
      cells.push(on ? "1" : "0");
    }
  return cells.join("");
}

/**
 * Maps drawn on the art-pixel grid (PIXEL_ART_STYLE_GUIDE.md §3) are played at
 * exactly their own size: one map pixel = one character pixel, so the
 * character-size choice doesn't apply to them. Older, high-resolution maps
 * keep the choice.
 */
export const lockedStageWidth = (mapW: number): number | null => (isNativeSize(mapW) ? Math.round(mapW) : null);

export function defaultLayout(mapW: number, mapH: number, perspective: Perspective = "angled"): SceneLayout {
  const { cols, rows } = gridFor(mapW, mapH);
  return { v: 1, perspective, stageWidth: lockedStageWidth(mapW) ?? DEFAULT_STAGE_WIDTH, cols, rows, floor: guessFloor(cols, rows, perspective), objects: [], spawns: [], reviewed: false, updatedAt: 0 };
}

/** Anything that isn't a usable layout (older maps, damaged data) gets the default guess. */
export function readLayout(raw: unknown, mapW: number, mapH: number): SceneLayout {
  const base = defaultLayout(mapW, mapH);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<SceneLayout>;
  if (r.v !== 1 || typeof r.cols !== "number" || typeof r.rows !== "number" || typeof r.floor !== "string" || r.floor.length !== r.cols * r.rows) return base;
  const rect = (b: Rect): Rect => {
    const x0 = clamp01(Math.min(b.x0, b.x1));
    const y0 = clamp01(Math.min(b.y0, b.y1));
    return { x0, y0, x1: clamp01(Math.max(b.x0, b.x1)), y1: clamp01(Math.max(b.y0, b.y1)) };
  };
  return {
    v: 1,
    perspective: r.perspective === "side" ? "side" : "angled",
    stageWidth: lockedStageWidth(mapW) ?? (typeof r.stageWidth === "number" && r.stageWidth >= 240 && r.stageWidth <= 1200 ? Math.round(r.stageWidth) : DEFAULT_STAGE_WIDTH),
    cols: r.cols,
    rows: r.rows,
    floor: r.floor.replace(/[^1]/g, "0"),
    objects: (Array.isArray(r.objects) ? r.objects : [])
      .filter((o): o is SceneObject => !!o && typeof o.id === "string" && !!o.bounds)
      .map((o) => ({
        id: o.id,
        label: String(o.label ?? "").slice(0, 40),
        type: SCENE_OBJECT_TYPES.includes(o.type) ? o.type : "feature",
        bounds: rect(o.bounds),
        solid: !!o.solid,
        front: !!o.front,
        ...(typeof o.exit === "boolean" ? { exit: o.exit } : {}),
        ...(typeof o.keeper === "string" && o.keeper ? { keeper: o.keeper.slice(0, 80) } : {}),
        ...(o.locked ? { locked: true } : {}),
        ...(typeof o.keyName === "string" && o.keyName.trim() ? { keyName: o.keyName.trim().slice(0, 30) } : {}),
        ...(o.startsOpen ? { startsOpen: true } : {}),
        ...(typeof o.note === "string" && o.note.trim() ? { note: o.note.slice(0, 280) } : {}),
        ...(Array.isArray(o.contents) ? { contents: o.contents.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().slice(0, 40)).slice(0, 8) } : {}),
      })),
    spawns: (Array.isArray(r.spawns) ? r.spawns : []).filter((p) => p && typeof p.x === "number" && typeof p.y === "number").map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) })).slice(0, 12),
    reviewed: !!r.reviewed,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
  };
}

// ---------------------------------------------------------------- floor painting

/** Paint (or erase) a round brush of `radius` cells around a cell. Returns the new floor string. */
export function paintFloor(l: Pick<SceneLayout, "cols" | "rows" | "floor">, col: number, row: number, radius: number, on: boolean): string {
  const cells = l.floor.split("");
  const r2 = (radius + 0.35) ** 2;
  for (let r = Math.floor(row - radius); r <= Math.ceil(row + radius); r++)
    for (let c = Math.floor(col - radius); c <= Math.ceil(col + radius); c++) {
      if (r < 0 || c < 0 || r >= l.rows || c >= l.cols) continue;
      if ((c - col) ** 2 + (r - row) ** 2 > r2) continue;
      cells[r * l.cols + c] = on ? "1" : "0";
    }
  return cells.join("");
}

/** Paint along a stroke from one cell to another (so fast drags leave no gaps). */
export function paintStroke(l: Pick<SceneLayout, "cols" | "rows" | "floor">, from: Point, to: Point, radius: number, on: boolean): string {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / Math.max(0.5, radius / 2)));
  let floor = l.floor;
  for (let i = 0; i <= steps; i++) floor = paintFloor({ ...l, floor }, from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, radius, on);
  return floor;
}

export const floorShare = (floor: string) => (floor.length ? (floor.match(/1/g)?.length ?? 0) / floor.length : 0);

// ---------------------------------------------------------------- building the playable scene

export type BuiltScene = {
  size: { width: number; height: number };
  room: RoomLayout;
  objects: WorldObject[];
  /** Solid objects drawn over characters behind them (stage art px). */
  fronts: { id: string; bounds: Rect; baseY: number }[];
  /** Problems the editor shows ("bar counter can't be reached"). */
  problems: { objectId: string; kind: "unreachable" }[];
};

/** The part of a solid object that stands on the floor: its lower part. */
export function footprintOf(b: Rect, perspective: Perspective): Rect {
  const h = b.y1 - b.y0;
  const depth = perspective === "angled" ? Math.max(6, h * 0.45) : Math.max(4, h * 0.25);
  return { x0: b.x0, y0: Math.max(b.y0, b.y1 - depth), x1: b.x1, y1: b.y1 };
}

/** Words for each kind of object, so "I'm going upstairs" / "我去楼上" finds the stairs on any map. */
const TYPE_WORDS: Record<ObjectType, string[]> = {
  book: ["bookshelf", "books", "书架", "书"],
  sign: ["sign", "招牌", "牌子"],
  seat: ["chair", "seat", "bench", "椅子", "座位"],
  door: ["door", "exit", "outside", "门", "门口", "出去"],
  painting: ["painting", "picture", "画"],
  item: [],
  window: ["window", "窗", "窗户", "窗边"],
  gift: ["gift", "礼物"],
  plant: ["plant", "植物"],
  light: ["lamp", "light", "灯"],
  feature: [],
  stairs: ["stairs", "staircase", "upstairs", "downstairs", "楼梯", "楼上", "楼下", "上楼"],
  counter: ["counter", "bar", "吧台", "柜台"],
  table: ["table", "桌子", "桌"],
  bed: ["bed", "床"],
  chest: ["chest", "box", "箱子", "宝箱"],
  exit: ["exit", "way out", "出口"],
  portal: ["portal", "传送门"],
};

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[\s,，、.。/]+/)
    .filter(Boolean);

/** Turn a stored layout into the stage's units: the room the planner walks on, its objects and their anchors. */
export function buildScene(layout: SceneLayout, mapW: number, mapH: number, place: EnvironmentTypeId): BuiltScene {
  const width = layout.stageWidth;
  const height = Math.round((width * mapH) / Math.max(1, mapW));
  const cw = width / layout.cols;
  const ch = height / layout.rows;
  const toStage = (b: Rect): Rect => ({ x0: b.x0 * width, y0: b.y0 * height, x1: b.x1 * width, y1: b.y1 * height });

  const cells = new Uint8Array(layout.cols * layout.rows);
  let wx0 = Infinity, wy0 = Infinity, wx1 = -Infinity, wy1 = -Infinity;
  for (let i = 0; i < cells.length; i++) {
    if (layout.floor[i] !== "1") continue;
    cells[i] = 1;
    const c = i % layout.cols;
    const r = Math.floor(i / layout.cols);
    wx0 = Math.min(wx0, c * cw);
    wy0 = Math.min(wy0, r * ch);
    wx1 = Math.max(wx1, (c + 1) * cw);
    wy1 = Math.max(wy1, (r + 1) * ch);
  }
  const walk = Number.isFinite(wx0) ? { x0: wx0, y0: wy0, x1: wx1, y1: wy1 } : { x0: 0, y0: 0, x1: 0, y1: 0 };
  const mask: NavMask = { cols: layout.cols, rows: layout.rows, cw, ch, cells };

  const obstacles: Obstacle[] = [];
  const fronts: BuiltScene["fronts"] = [];
  for (const o of layout.objects) {
    if (!o.solid) continue;
    const b = toStage(o.bounds);
    obstacles.push({ id: o.id, ...footprintOf(b, layout.perspective) });
    if (o.front) fronts.push({ id: o.id, bounds: b, baseY: b.y1 });
  }
  const spawns = layout.spawns.map((p) => ({ x: p.x * width, y: p.y * height }));
  const room: RoomLayout = { walk, obstacles, size: { width, height }, mask, spawns };

  const objects: WorldObject[] = [];
  const problems: BuiltScene["problems"] = [];
  for (const o of layout.objects) {
    const b = toStage(o.bounds);
    const anchors = anchorsFor(room, b, o.solid ? (obstacles.find((x) => x.id === o.id) ?? null) : null);
    if (!anchors.length) problems.push({ objectId: o.id, kind: "unreachable" });
    objects.push({
      id: o.id,
      type: o.type,
      name: "custom",
      label: o.label.trim() || undefined,
      world: "default",
      place,
      bounds: b,
      collider: o.solid ? o.id : null,
      anchors,
      radius: 6,
      actions: OBJECT_ACTIONS_BY_TYPE[o.type] ?? ["inspect"],
      tags: [...new Set([...words(o.label), o.type, ...TYPE_WORDS[o.type]])],
      ...(o.note ? { description: o.note } : {}),
      exit: o.exit ?? EXIT_TYPES.includes(o.type),
      ...(o.keeper ? { keeper: o.keeper } : {}),
      ...(o.locked ? { locked: true } : {}),
      ...(o.keyName ? { keyName: o.keyName } : {}),
      ...(o.startsOpen ? { startsOpen: true } : {}),
      ...(o.contents?.length ? { contents: o.contents } : {}),
    });
  }
  return { size: { width, height }, room, objects, fronts, problems };
}

/** Where a character stands to use an object: in front of it, then beside it, then behind; never inside furniture. */
function anchorsFor(room: RoomLayout, b: Rect, foot: Rect | null): Point[] {
  const midX = (b.x0 + b.x1) / 2;
  const base = foot ?? { x0: b.x0, y0: b.y1 - 2, x1: b.x1, y1: b.y1 };
  const midY = (base.y0 + base.y1) / 2;
  const want: Point[] = foot
    ? [
        { x: midX, y: base.y1 + FOOT.d / 2 + 2 },
        { x: base.x0 - FOOT.w / 2 - 2, y: midY },
        { x: base.x1 + FOOT.w / 2 + 2, y: midY },
        { x: midX, y: base.y0 - FOOT.d / 2 - 2 },
      ]
    : [{ x: midX, y: Math.min(b.y1, (b.y0 + b.y1) / 2 + (b.y1 - b.y0) / 4) }, { x: midX, y: b.y1 + FOOT.d / 2 + 2 }];
  const out: Point[] = [];
  for (const w of want) {
    const p = nearestFree(room, w, [], 0, 28);
    if (p && !out.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 8)) out.push(p);
    if (out.length >= 3) break;
  }
  return out;
}

/** A short name for a map, from its description (the player can rename it). */
export function nameFromDescription(description: string): string {
  const first = description.trim().split(/[。.!！?？\n,，;；]/)[0]?.trim() ?? "";
  if (!first) return "";
  const chars = [...first];
  return chars.length > 24 ? `${chars.slice(0, 23).join("")}…` : first;
}
