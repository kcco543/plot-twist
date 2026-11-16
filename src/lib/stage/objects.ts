/**
 * WORLD OBJECTS — the things in a scene a character can walk up to and use.
 * --------------------------------------------------------------------------
 * The background art is only a picture: nothing here is read from its
 * pixels. Every interactive object is written down by hand for each built-in
 * room (an explicit annotation layer on top of the art), and collision comes
 * from the room's floor rectangle + obstacle list (room.ts), which the A*
 * planner turns into its walkable grid. An AI-generated map has no such
 * annotations, so play keeps using the annotated built-in rooms.
 *
 * Each object has:
 *   id          unique within the room
 *   type        what kind of thing it is (book, door, seat…)
 *   name        i18n key under objects.names (so it reads in both languages)
 *   world/place which room it belongs to ("default" = every world except Otherworld,
 *               whose art is laid out differently)
 *   bounds      where it is drawn (art px): what a drag is dropped onto
 *   collider    the obstacle id that blocks walking, or null for things on
 *               the wall / floor you can stand at or on
 *   anchors     where a character stands (feet) to use it, never inside a collider
 *   radius      arrival tolerance around an anchor
 *   actions     what can be done with it
 *   tags        words for it (EN + ZH) so dialogue like "I'm going to the window"
 *               can find it (see autonomy/goals.ts)
 *   private     a quiet spot a character can retreat to
 */
import type { EnvironmentTypeId, GiftInstance, WorldId } from "../types";
import { FOOT, insideWalk, hitsObstacle, type Point, type Rect, type RoomLayout } from "./room";

export const OBJECT_TYPES = ["book", "sign", "seat", "door", "painting", "item", "window", "gift", "plant", "light", "feature", "stairs", "counter", "table", "bed", "chest", "exit", "portal"] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

export const OBJECT_ACTIONS = [
  "read",
  "examine",
  "sit",
  "open",
  "inspect",
  "pick_up",
  "look_out",
  "admire",
  // Explorable world (src/lib/explore/interact.ts): real actions whose result is decided by game rules + object state.
  "climb",
  "talk",
  "order",
  "close",
  "knock",
  "unlock",
  "browse",
  "place",
  "rest",
  "search",
  "leave",
  "enter",
] as const;
export type ObjectAction = (typeof OBJECT_ACTIONS)[number];

export type WorldObject = {
  id: string;
  type: ObjectType;
  name: string;
  /** The player's own name for an object on a generated map (shown instead of objects.names.<name>). */
  label?: string;
  world: WorldId | "default";
  place: EnvironmentTypeId;
  bounds: Rect;
  collider: string | null;
  anchors: Point[];
  radius: number;
  actions: ObjectAction[];
  description?: string;
  tags: string[];
  private?: boolean;
  /** Gift objects: the gift instance and its owner (only the owner may pick it up). */
  giftId?: string;
  ownerId?: string;
  // ---- Explorable world (all optional; see src/lib/explore/)
  /** Leads out of this scene (doors, stairs, exits, portals): using it can propose leaving the area. */
  exit?: boolean;
  /** Counters and the like: the character who works here (the bartender). Missing = whoever stands behind it. */
  keeper?: string | null;
  /** Starts locked (doors, chests). The live state is kept per scene in the world save. */
  locked?: boolean;
  /** A locked object opens for someone carrying an item whose name contains this ("key", "钥匙"). */
  keyName?: string;
  /** Doors / chests that start open. */
  startsOpen?: boolean;
  /** What a chest holds (found with "search"). */
  contents?: string[];
  /** An exit marker added by the game (the way back to another scene), not part of the map. */
  marker?: boolean;
};

/**
 * What can be done with each kind of object. Which of these are possible
 * RIGHT NOW (a locked door can't be opened, a chest must be open to search
 * it…) is decided by src/lib/explore/interact.ts from the object's state.
 */
export const ACTIONS_BY_TYPE: Record<ObjectType, ObjectAction[]> = {
  book: ["browse", "read"],
  sign: ["read"],
  seat: ["sit"],
  door: ["open", "leave", "close", "knock", "unlock"],
  painting: ["inspect"],
  item: ["examine"],
  window: ["look_out"],
  gift: ["admire", "pick_up"],
  plant: ["inspect"],
  light: ["inspect"],
  feature: ["inspect"],
  stairs: ["climb", "inspect"],
  counter: ["talk", "order", "inspect"],
  table: ["examine", "place"],
  bed: ["rest", "sit"],
  chest: ["open", "search", "close", "unlock"],
  exit: ["leave"],
  portal: ["enter", "inspect"],
};
/** Kinds of object that lead somewhere else by default. */
export const EXIT_TYPES: ObjectType[] = ["door", "stairs", "exit", "portal"];

const rect = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0, y0, x1, y1 });
type Def = Omit<WorldObject, "world" | "place" | "radius"> & { radius?: number };

/** Built-in interior used by Western Fantasy, Modern and Ancient China (same layout, different paint). */
const DEFAULT_OBJECTS: Partial<Record<EnvironmentTypeId, Def[]>> = {
  interior: [
    { id: "window", type: "window", name: "window", bounds: rect(36, 14, 104, 73), collider: null, anchors: [{ x: 70, y: 146 }, { x: 90, y: 146 }], actions: ["look_out"], tags: ["window", "outside", "窗", "窗户", "窗边"] },
    { id: "bookshelf", type: "book", name: "bookshelf", bounds: rect(139, 24, 201, 46), collider: null, anchors: [{ x: 124, y: 147 }, { x: 196, y: 150 }], actions: ["read", "examine"], tags: ["bookshelf", "books", "book", "shelf", "reading", "书架", "书", "看书"], private: true },
    { id: "painting", type: "painting", name: "wallArt", bounds: rect(206, 24, 233, 57), collider: null, anchors: [{ x: 220, y: 147 }], actions: ["inspect"], tags: ["painting", "picture", "poster", "banner", "画", "挂画", "海报"] },
    { id: "door", type: "door", name: "door", bounds: rect(243, 28, 289, 105), collider: null, anchors: [{ x: 266, y: 146 }], actions: ["open"], tags: ["door", "exit", "outside", "门", "门口", "出去"] },
    { id: "table-item", type: "table", name: "tableNote", bounds: rect(136, 100, 184, 128), collider: "table", anchors: [{ x: 160, y: 151 }, { x: 128, y: 146 }, { x: 192, y: 146 }], actions: ["examine"], tags: ["table", "note", "桌子", "桌", "纸条"] },
    { id: "rug", type: "seat", name: "rug", bounds: rect(92, 146, 228, 176), collider: null, anchors: [{ x: 116, y: 168 }, { x: 204, y: 168 }], actions: ["sit"], tags: ["rug", "carpet", "sit", "地毯", "坐"] },
    { id: "plant", type: "plant", name: "plant", bounds: rect(12, 94, 41, 134), collider: "plant", anchors: [{ x: 52, y: 146 }], actions: ["inspect"], tags: ["plant", "pot", "植物", "盆栽", "花"] },
  ],
  street: [
    { id: "sign", type: "sign", name: "shopSign", bounds: rect(94, 50, 150, 68), collider: null, anchors: [{ x: 120, y: 152 }], actions: ["read"], tags: ["sign", "shop sign", "招牌", "牌子"] },
    { id: "shop-door", type: "door", name: "shopDoor", bounds: rect(186, 100, 214, 142), collider: null, anchors: [{ x: 200, y: 152 }], actions: ["open"], tags: ["shop", "store", "door", "café", "cafe", "商店", "店", "门"] },
    { id: "lamp-l", type: "light", name: "lamp", bounds: rect(62, 88, 80, 150), collider: "lamp-l", anchors: [{ x: 56, y: 156 }, { x: 86, y: 156 }], actions: ["inspect"], tags: ["lamp", "streetlight", "路灯", "灯"] },
    { id: "lamp-r", type: "light", name: "lamp", bounds: rect(242, 88, 260, 150), collider: "lamp-r", anchors: [{ x: 236, y: 156 }, { x: 266, y: 156 }], actions: ["inspect"], tags: ["lamp", "streetlight", "路灯", "灯"] },
  ],
  wilderness: [
    { id: "mushroom-l", type: "feature", name: "mushroom", bounds: rect(48, 150, 72, 176), collider: "mushroom-l", anchors: [{ x: 60, y: 160 }, { x: 40, y: 168 }], actions: ["inspect"], tags: ["mushroom", "mushrooms", "蘑菇"], private: true },
    { id: "mushroom-r", type: "seat", name: "bigMushroom", bounds: rect(256, 146, 280, 170), collider: "mushroom-r", anchors: [{ x: 288, y: 165 }], actions: ["inspect", "sit"], tags: ["mushroom", "蘑菇"] },
  ],
  ruins: [
    { id: "cone-r", type: "feature", name: "rubble", bounds: rect(285, 140, 301, 164), collider: "cone-r", anchors: [{ x: 276, y: 160 }], actions: ["inspect"], tags: ["rubble", "ruins", "stones", "废墟", "石头"], private: true },
    { id: "cone-s", type: "feature", name: "oldStone", bounds: rect(203, 160, 217, 182), collider: "cone-s", anchors: [{ x: 198, y: 166 }, { x: 224, y: 176 }], actions: ["examine"], tags: ["stone", "石头"] },
  ],
  dreamscape: [
    { id: "mushroom-pink", type: "seat", name: "bigMushroom", bounds: rect(26, 138, 52, 166), collider: "mushroom-pink", anchors: [{ x: 40, y: 170 }], actions: ["inspect", "sit"], tags: ["mushroom", "pink mushroom", "蘑菇"], private: true },
    { id: "mushroom-teal", type: "feature", name: "mushroom", bounds: rect(276, 144, 302, 172), collider: "mushroom-teal", anchors: [{ x: 288, y: 176 }], actions: ["inspect"], tags: ["mushroom", "蘑菇"] },
  ],
};

const OTHERWORLD_OBJECTS: Partial<Record<EnvironmentTypeId, Def[]>> = {
  interior: [
    { id: "window", type: "window", name: "roundWindow", bounds: rect(40, 18, 102, 76), collider: null, anchors: [{ x: 66, y: 152 }], actions: ["look_out"], tags: ["window", "outside", "窗", "窗户", "窗边"] },
    { id: "potion-shelf", type: "item", name: "potionShelf", bounds: rect(134, 32, 210, 58), collider: null, anchors: [{ x: 124, y: 152 }, { x: 198, y: 158 }], actions: ["examine"], tags: ["shelf", "potions", "bottles", "架子", "药水", "瓶子"] },
    { id: "door", type: "door", name: "door", bounds: rect(260, 26, 302, 114), collider: null, anchors: [{ x: 282, y: 152 }], actions: ["open"], tags: ["door", "exit", "outside", "门", "门口", "出去"] },
    { id: "cushion", type: "seat", name: "cushion", bounds: rect(76, 150, 110, 178), collider: "cushion", anchors: [{ x: 92, y: 158 }, { x: 116, y: 168 }], actions: ["sit"], tags: ["cushion", "pillow", "sit", "垫子", "坐垫", "坐"], private: true },
    { id: "lantern", type: "light", name: "lantern", bounds: rect(20, 136, 42, 168), collider: "lantern", anchors: [{ x: 31, y: 174 }], actions: ["inspect"], tags: ["lantern", "light", "灯笼", "灯"] },
    { id: "plant", type: "plant", name: "plant", bounds: rect(212, 120, 250, 168), collider: "plant", anchors: [{ x: 231, y: 174 }], actions: ["inspect"], tags: ["plant", "植物", "盆栽"] },
  ],
  street: [
    { id: "crystals-l", type: "feature", name: "crystals", bounds: rect(0, 128, 26, 157), collider: "crystals-l", anchors: [{ x: 34, y: 160 }], actions: ["inspect"], tags: ["crystals", "crystal", "水晶"] },
    { id: "slime", type: "feature", name: "slime", bounds: rect(214, 172, 234, 191), collider: "slime", anchors: [{ x: 224, y: 170 }], actions: ["inspect"], tags: ["slime", "史莱姆"] },
  ],
  wilderness: [
    { id: "house", type: "door", name: "tinyHouse", bounds: rect(12, 120, 48, 162), collider: "house", anchors: [{ x: 56, y: 156 }], actions: ["open", "inspect"], tags: ["house", "home", "cottage", "小屋", "房子", "家"], private: true },
    { id: "pond", type: "feature", name: "pond", bounds: rect(46, 160, 116, 180), collider: "pond", anchors: [{ x: 124, y: 170 }], actions: ["look_out"], tags: ["pond", "water", "池塘", "水"] },
  ],
  ruins: [
    { id: "steps", type: "seat", name: "steps", bounds: rect(98, 118, 222, 152), collider: "steps", anchors: [{ x: 140, y: 156 }, { x: 186, y: 156 }], actions: ["sit", "inspect"], tags: ["steps", "stairs", "台阶", "楼梯"] },
  ],
  dreamscape: [
    { id: "potion", type: "item", name: "potion", bounds: rect(106, 160, 128, 182), collider: "potion", anchors: [{ x: 100, y: 176 }, { x: 136, y: 176 }], actions: ["examine"], tags: ["potion", "bottle", "药水", "瓶子"] },
    { id: "mushroom", type: "seat", name: "bigMushroom", bounds: rect(10, 150, 44, 178), collider: "mushroom", anchors: [{ x: 50, y: 172 }], actions: ["sit", "inspect"], tags: ["mushroom", "蘑菇"], private: true },
  ],
};

/** The hand-annotated objects of a built-in room. */
export function objectsFor(world: WorldId, place: EnvironmentTypeId): WorldObject[] {
  const set = world === "otherworld" ? OTHERWORLD_OBJECTS : DEFAULT_OBJECTS;
  const w: WorldObject["world"] = world === "otherworld" ? "otherworld" : "default";
  return (set[place] ?? []).map((d) => ({
    radius: 6,
    ...d,
    // Hand-written actions first, then everything this kind of object supports (doors open AND close, etc.).
    actions: [...new Set([...d.actions, ...ACTIONS_BY_TYPE[d.type]])],
    exit: d.exit ?? (EXIT_TYPES.includes(d.type) && d.id !== "house" ? true : undefined),
    world: w,
    place,
  }));
}

/** A displayed gift is an object too: anyone can admire it; only its owner can pick it up again. */
export function giftObject(gift: GiftInstance, spot: { id: string; x: number; y: number }, room: RoomLayout, world: WorldObject["world"], place: EnvironmentTypeId): WorldObject {
  const host = room.obstacles.find((o) => o.id === spot.id);
  const below = host ? { x: spot.x, y: host.y1 + FOOT.d / 2 + 2 } : { x: spot.x, y: spot.y + 8 };
  const sides = host ? [{ x: host.x0 - FOOT.w / 2 - 3, y: Math.round((host.y0 + host.y1) / 2) }, { x: host.x1 + FOOT.w / 2 + 3, y: Math.round((host.y0 + host.y1) / 2) }] : [];
  return {
    id: `gift:${gift.id}`,
    type: "gift",
    name: "gift",
    world,
    place,
    bounds: rect(spot.x - 7, spot.y - 13, spot.x + 7, spot.y + 1),
    collider: spot.id,
    anchors: [below, ...sides],
    radius: 6,
    actions: ["admire", "pick_up"],
    tags: [gift.name.toLowerCase(), "gift", "礼物"],
    giftId: gift.id,
    ownerId: gift.owner,
  };
}

/** May `actorId` do `action` with this object? (gifts: only the owner picks theirs up). */
export function actionAllowed(o: WorldObject, action: ObjectAction, actorId: string): boolean {
  if (!o.actions.includes(action)) return false;
  if (o.type === "gift" && action === "pick_up") return o.ownerId === actorId;
  return true;
}

/** What a character does by default when sent to an object (first allowed action). */
export function defaultAction(o: WorldObject, actorId: string): ObjectAction | null {
  return o.actions.find((a) => actionAllowed(o, a, actorId) && !(o.type === "gift" && a === "pick_up")) ?? null;
}

/** Topmost object under a stage point (art px). Smaller objects win over big ones they sit on. */
export function hitObject(objects: WorldObject[], p: Point, pad = 2): WorldObject | null {
  let best: WorldObject | null = null;
  let bestArea = Infinity;
  for (const o of objects) {
    const b = o.bounds;
    if (p.x < b.x0 - pad || p.x > b.x1 + pad || p.y < b.y0 - pad || p.y > b.y1 + pad) continue;
    const area = (b.x1 - b.x0) * (b.y1 - b.y0);
    if (area < bestArea) {
      best = o;
      bestArea = area;
    }
  }
  return best;
}

/** Anchors that are actually standable in this room (on the floor, not inside furniture). */
export function validAnchors(room: RoomLayout, o: WorldObject): Point[] {
  return o.anchors.filter((a) => insideWalk(room, a) && !hitsObstacle(room, a));
}

/** Sanity check for the annotation tables (tests): every object has a usable anchor and real collider. */
export function checkObjects(room: RoomLayout, objects: WorldObject[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const o of objects) {
    if (ids.has(o.id)) problems.push(`${o.id}: duplicate id`);
    ids.add(o.id);
    if (!validAnchors(room, o).length) problems.push(`${o.id}: no standable anchor`);
    if (o.collider && !room.obstacles.some((x) => x.id === o.collider)) problems.push(`${o.id}: unknown collider ${o.collider}`);
    if (!o.actions.length) problems.push(`${o.id}: no actions`);
  }
  return problems;
}
