/**
 * SCENES — several connected places inside ONE world save (pure, unit-tested).
 * --------------------------------------------------------------------------
 * A world (one save) holds a list of scenes ("Tavern", "Upstairs rooms",
 * "Library"…). Each scene has its own map (a generated picture + its play
 * area, or a built-in room), its own object states (which doors are open),
 * where the characters in it stand, and the exit markers the game added.
 * Scenes are joined by explicit LINKS: "the tavern's stairs lead to the
 * Upstairs rooms, arriving at their landing" (and back, for doors and stairs).
 * Nothing is ever connected without such a link.
 *
 * The ACTIVE scene's map is still `save.environment` (so World Builder, map
 * generation and the play-area editor keep working unchanged); the scene
 * record mirrors it and takes it over again when the player travels.
 *
 * Characters live in exactly one scene (`where`); travelling moves only the
 * characters who go, everyone else stays where they were. A character not
 * listed (added in the Studio since) is wherever the player is.
 *
 * Saved in SaveData.scenes as plain JSON, per world: World A's scenes and
 * their state can never touch World B's.
 */
import type { SavedSpot } from "../stage/sim";
import type { Point } from "../stage/room";
import type { EnvironmentDraft, EnvironmentTypeId } from "../types";
import type { ObjectState } from "./interact";

export const LINK_KINDS = ["door", "stairs", "exit", "portal", "path"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** A way back added by the game (the destination has no exit of its own yet). Position: fractions of the stage. */
export type SceneMarker = { id: string; kind: LinkKind; at: Point };

export type SceneRecord = {
  id: string;
  /** The player's name for it (missing = the map's name or the place type). */
  name: string;
  description: string;
  envType: EnvironmentTypeId;
  /** Generated map in the map library, or null for the built-in room. */
  mapId: string | null;
  /** Made without a generated map (image generation unavailable or declined). */
  placeholder?: boolean;
  createdAt: number;
  updatedAt: number;
  /** Object states by object id (doors open/closed/locked, chests searched…). */
  objects: Record<string, ObjectState>;
  /** Where the characters in this scene stood when the player last left it. */
  spots: Record<string, SavedSpot>;
  markers: SceneMarker[];
};

export type SceneLink = {
  id: string;
  from: string;
  /** The object in `from` that leads here (door, stairs, exit marker…). */
  fromExit: string;
  to: string;
  /** Where travellers appear in `to`: an object id there (its interaction point), or null = the scene's start spots. */
  toEntrance: string | null;
  kind: LinkKind;
  /** Usable both ways (doors, stairs). One-way for portals and story transitions. */
  twoWay: boolean;
  /** Extra condition for using it (none yet beyond the object's own state, e.g. a locked door). */
  requires?: { open?: boolean };
  createdAt: number;
};

export type WorldScenes = {
  v: 1;
  active: string;
  list: SceneRecord[];
  links: SceneLink[];
  /** Which scene each character is in (missing = wherever the player is). */
  where: Record<string, string>;
};

export const MAX_SCENES = 24;
export const SCENE_NAME_MAX = 40;
export const FIRST_SCENE_ID = "scene-main";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number, fallback = "") => (typeof v === "string" ? v.slice(0, max) : fallback);
const ENV_TYPES: EnvironmentTypeId[] = ["interior", "street", "wilderness", "ruins", "dreamscape"];

export function newScene(p: { id: string; name: string; description: string; envType: EnvironmentTypeId; mapId: string | null; placeholder?: boolean }, now = Date.now()): SceneRecord {
  return { id: p.id, name: p.name.slice(0, SCENE_NAME_MAX), description: p.description.slice(0, 1200), envType: p.envType, mapId: p.mapId, ...(p.placeholder ? { placeholder: true } : {}), createdAt: now, updatedAt: now, objects: {}, spots: {}, markers: [] };
}

/** The scenes of a world, from whatever is saved (older saves: one scene made from the environment). */
export function normalizeScenes(raw: unknown, env: EnvironmentDraft): WorldScenes {
  const first = (): WorldScenes => ({ v: 1, active: FIRST_SCENE_ID, list: [newScene({ id: FIRST_SCENE_ID, name: "", description: env.description, envType: env.type, mapId: env.mapId ?? null }, 0)], links: [], where: {} });
  if (!isObj(raw) || !Array.isArray(raw.list)) return first();
  const list: SceneRecord[] = [];
  for (const r of raw.list.slice(0, MAX_SCENES)) {
    if (!isObj(r) || typeof r.id !== "string" || !r.id || list.some((x) => x.id === r.id)) continue;
    list.push({
      id: r.id,
      name: str(r.name, SCENE_NAME_MAX),
      description: str(r.description, 1200),
      envType: ENV_TYPES.includes(r.envType as EnvironmentTypeId) ? (r.envType as EnvironmentTypeId) : "interior",
      mapId: typeof r.mapId === "string" && r.mapId ? r.mapId : null,
      ...(r.placeholder ? { placeholder: true } : {}),
      createdAt: typeof r.createdAt === "number" ? r.createdAt : 0,
      updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
      objects: isObj(r.objects) ? (r.objects as Record<string, ObjectState>) : {},
      spots: isObj(r.spots) ? (r.spots as Record<string, SavedSpot>) : {},
      markers: (Array.isArray(r.markers) ? r.markers : [])
        .filter((m): m is SceneMarker => isObj(m) && typeof m.id === "string" && isObj(m.at) && typeof (m.at as Point).x === "number" && typeof (m.at as Point).y === "number")
        .map((m) => ({ id: m.id, kind: LINK_KINDS.includes(m.kind) ? m.kind : "exit", at: { x: clamp01(m.at.x), y: clamp01(m.at.y) } }))
        .slice(0, 12),
    });
  }
  if (!list.length) return first();
  const ids = new Set(list.map((s) => s.id));
  const active = typeof raw.active === "string" && ids.has(raw.active) ? raw.active : list[0].id;
  const links = (Array.isArray(raw.links) ? raw.links : [])
    .filter((l): l is SceneLink => isObj(l) && typeof l.id === "string" && typeof l.from === "string" && typeof l.to === "string" && typeof l.fromExit === "string")
    // A link must join two different scenes that both exist (no dangling or circular self-references).
    .filter((l) => ids.has(l.from) && ids.has(l.to) && l.from !== l.to)
    .map((l) => ({ id: l.id, from: l.from, fromExit: l.fromExit, to: l.to, toEntrance: typeof l.toEntrance === "string" ? l.toEntrance : null, kind: LINK_KINDS.includes(l.kind) ? l.kind : "exit", twoWay: !!l.twoWay, ...(isObj(l.requires) ? { requires: l.requires } : {}), createdAt: typeof l.createdAt === "number" ? l.createdAt : 0 }));
  // One link per exit (the newest wins), so an exit never leads to two places.
  const seen = new Set<string>();
  const unique = [...links].reverse().filter((l) => {
    const k = `${l.from}|${l.fromExit}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).reverse();
  const where: Record<string, string> = {};
  if (isObj(raw.where)) for (const [c, s] of Object.entries(raw.where)) if (typeof s === "string" && ids.has(s)) where[c] = s;
  const out: WorldScenes = { v: 1, active, list, links: unique, where };
  return syncActive(out, env);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const sceneById = (w: WorldScenes, id: string | null | undefined) => (id ? (w.list.find((s) => s.id === id) ?? null) : null);
export const activeScene = (w: WorldScenes) => sceneById(w, w.active) ?? w.list[0];

/** The active scene's record takes the current environment (World Builder may have changed the map). */
export function syncActive(w: WorldScenes, env: EnvironmentDraft): WorldScenes {
  const a = activeScene(w);
  const mapId = env.mapId ?? null;
  if (a.envType === env.type && a.mapId === mapId && a.description === env.description) return w;
  return { ...w, list: w.list.map((s) => (s.id === a.id ? { ...s, envType: env.type, mapId, description: env.description, placeholder: mapId ? undefined : s.placeholder } : s)) };
}

export const envOf = (s: SceneRecord): EnvironmentDraft => ({ description: s.description, type: s.envType, mapId: s.mapId });

/** The link that starts at this exit, or (for two-way links) the one that arrives at it. */
export function linkAt(w: WorldScenes, sceneId: string, objectId: string): { link: SceneLink; to: string; entrance: string | null; reverse: boolean } | null {
  const fwd = w.links.find((l) => l.from === sceneId && l.fromExit === objectId);
  if (fwd) return { link: fwd, to: fwd.to, entrance: fwd.toEntrance, reverse: false };
  const back = w.links.find((l) => l.twoWay && l.to === sceneId && l.toEntrance === objectId);
  if (back) return { link: back, to: back.from, entrance: back.fromExit, reverse: true };
  return null;
}

/** Scene ids directly reachable from a scene (for the picker's "connected" badge). */
export function neighbours(w: WorldScenes, sceneId: string): string[] {
  const out = new Set<string>();
  for (const l of w.links) {
    if (l.from === sceneId) out.add(l.to);
    if (l.twoWay && l.to === sceneId) out.add(l.from);
  }
  return [...out];
}

/** Which scene a character is in. */
export const sceneOf = (w: WorldScenes, characterId: string) => w.where[characterId] ?? w.active;

/** Characters (by id) that are in the given scene. */
export function presentIn<T extends { id: string }>(w: WorldScenes, sceneId: string, cast: T[]): T[] {
  return cast.filter((c) => (w.where[c.id] ?? w.active) === sceneId);
}

/** Add a scene (capped). */
export function addScene(w: WorldScenes, s: SceneRecord): WorldScenes {
  if (w.list.length >= MAX_SCENES || w.list.some((x) => x.id === s.id)) return w;
  return { ...w, list: [...w.list, s] };
}

export function patchScene(w: WorldScenes, id: string, patch: Partial<Omit<SceneRecord, "id">>, now = Date.now()): WorldScenes {
  return { ...w, list: w.list.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: now } : s)) };
}

export function setObjectState(w: WorldScenes, sceneId: string, objectId: string, patch: Partial<ObjectState>, now = Date.now()): WorldScenes {
  const s = sceneById(w, sceneId);
  if (!s) return w;
  return patchScene(w, sceneId, { objects: { ...s.objects, [objectId]: { ...(s.objects[objectId] ?? {}), ...patch } } }, now);
}

export function addMarker(w: WorldScenes, sceneId: string, m: SceneMarker): WorldScenes {
  const s = sceneById(w, sceneId);
  if (!s || s.markers.some((x) => x.id === m.id)) return w;
  return patchScene(w, sceneId, { markers: [...s.markers, m].slice(-12) });
}

/**
 * Connect an exit to a destination. Validated: both scenes exist and differ,
 * and an exit leads to one place only (a new link replaces the exit's old one).
 */
export function connect(w: WorldScenes, l: SceneLink): { ok: true; scenes: WorldScenes } | { ok: false; reason: "unknown_scene" | "same_scene" } {
  if (!sceneById(w, l.from) || !sceneById(w, l.to)) return { ok: false, reason: "unknown_scene" };
  if (l.from === l.to) return { ok: false, reason: "same_scene" };
  const links = w.links.filter((x) => !(x.from === l.from && x.fromExit === l.fromExit) && !(l.twoWay && l.toEntrance && x.from === l.to && x.fromExit === l.toEntrance));
  return { ok: true, scenes: { ...w, links: [...links, l] } };
}

/** Link kind for an object type. */
export function linkKindFor(type: string): LinkKind {
  return type === "door" || type === "stairs" || type === "portal" || type === "exit" ? type : "path";
}

/** Doors and stairs go both ways by default; portals and plain exits one way. */
export const twoWayByDefault = (kind: LinkKind) => kind === "door" || kind === "stairs" || kind === "path";

/**
 * Travel: the active scene keeps where the stay-behinds stand (`leftSpots`),
 * the travellers move to `to`, and `to` becomes active. Returns the new
 * scenes and the environment to show. Pure: the caller saves both at once.
 */
export function travel(w: WorldScenes, p: { to: string; travellers: string[]; leftSpots: Record<string, SavedSpot>; env: EnvironmentDraft; presentIds: string[] }, now = Date.now()): { scenes: WorldScenes; env: EnvironmentDraft } | null {
  const from = activeScene(w);
  const dest = sceneById(w, p.to);
  if (!dest || dest.id === from.id) return null;
  let next = syncActive(w, p.env);
  // Everyone who was here and isn't travelling stays here (pinned now, so they don't follow the player).
  const where = { ...next.where };
  for (const id of p.presentIds) if (!p.travellers.includes(id)) where[id] = from.id;
  for (const id of p.travellers) where[id] = dest.id;
  const stay: Record<string, SavedSpot> = {};
  for (const [id, spot] of Object.entries(p.leftSpots)) if (!p.travellers.includes(id)) stay[id] = spot;
  next = patchScene({ ...next, where, active: dest.id }, from.id, { spots: { ...from.spots, ...stay } }, now);
  // Travellers' old spots in the destination no longer apply (they arrive at the entrance).
  const d = sceneById(next, dest.id)!;
  const destSpots = Object.fromEntries(Object.entries(d.spots).filter(([id]) => !p.travellers.includes(id)));
  next = patchScene(next, dest.id, { spots: destSpots }, now);
  return { scenes: next, env: envOf(sceneById(next, dest.id)!) };
}
