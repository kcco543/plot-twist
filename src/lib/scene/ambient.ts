/**
 * AMBIENT ANIMATION — small looping effects that make a scene feel alive
 * (pure data + rules, unit-tested; drawn by components/game/AmbientLayer.tsx).
 * --------------------------------------------------------------------------
 * Nothing here regenerates art or calls an AI. Each effect is a tiny local
 * animation drawn over one object's region, reusing the map's own pixels
 * where it moves them (sway) and a few procedural pixel sprites otherwise:
 *
 *   ripple   water: pale light lines drift across the region (clipped to it)
 *   sway     leaves, flowers, flags: the picture inside the region leans a
 *            pixel or two from its base, in steps
 *   flicker  lanterns, lamps: a warm glow breathes in steps
 *   flame    candles, braziers, a fire: a 3-frame pixel flame
 *   twinkle  stars, crystals, magic: a few sparkles blink at fixed spots
 *   pulse    portals, glowing things: a soft halo grows and fades
 *
 * Performance rules (see AmbientLayer):
 *   - CSS keyframe animations only, stepped (no per-frame JavaScript, no
 *     React re-render per frame), composited transforms / opacity
 *   - at most MAX_AMBIENT effects per scene, chosen by importance
 *   - effects outside the camera view are paused (IntersectionObserver)
 *   - everything stops with Reduce motion (the app's setting or the OS's)
 *
 * Metadata per object (SceneObject.ambient on generated maps; built-in rooms
 * get defaults from the object's kind and tags):
 *   kind, speed (0.5–2× the base tempo), phase (0–1, offset in the loop),
 *   loop ("loop" | "alternate"), enabled, visible
 */
import type { WorldObject } from "../stage/objects";

export const AMBIENT_KINDS = ["ripple", "sway", "flicker", "flame", "twinkle", "pulse"] as const;
export type AmbientKind = (typeof AMBIENT_KINDS)[number];

export type AmbientSpec = {
  kind: AmbientKind;
  /** Multiplier on the kind's base tempo (0.5 = half speed). */
  speed: number;
  /** Offset into the loop (0–1), so neighbours don't move in lockstep. */
  phase: number;
  loop: "loop" | "alternate";
  enabled: boolean;
  /** Hidden effects keep their settings but aren't drawn (e.g. a lantern that has been put out). */
  visible: boolean;
};

/** Base loop length per kind (ms) and how many steps it moves in. Few frames, slow tempo: atmosphere, not motion. */
export const AMBIENT_TEMPO: Record<AmbientKind, { ms: number; steps: number }> = {
  ripple: { ms: 3200, steps: 8 },
  sway: { ms: 2600, steps: 4 },
  flicker: { ms: 1800, steps: 5 },
  flame: { ms: 540, steps: 3 },
  twinkle: { ms: 2400, steps: 6 },
  pulse: { ms: 2800, steps: 6 },
};

/** At most this many animated objects per scene. Ambient animation is selective, never everything. */
export const MAX_AMBIENT = 10;

export const ambientSpec = (kind: AmbientKind, patch: Partial<AmbientSpec> = {}): AmbientSpec => ({ kind, speed: 1, phase: 0, loop: "loop", enabled: true, visible: true, ...patch });

const isKind = (v: unknown): v is AmbientKind => typeof v === "string" && (AMBIENT_KINDS as readonly string[]).includes(v);

/** Validate stored metadata (older layouts have none; damaged values fall back to safe ones). */
export function readAmbient(raw: unknown): AmbientSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<AmbientSpec>;
  if (!isKind(r.kind)) return null;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    kind: r.kind,
    speed: num(r.speed, 0.5, 2, 1),
    phase: num(r.phase, 0, 1, 0),
    loop: r.loop === "alternate" ? "alternate" : "loop",
    enabled: r.enabled !== false,
    visible: r.visible !== false,
  };
}

/** Words that suggest an effect, EN + ZH. Only used to pick a sensible DEFAULT; the player can change or turn it off. */
const HINTS: [AmbientKind, RegExp][] = [
  ["ripple", /water|pond|lake|river|stream|fountain|pool|sea|spring|waterfall|水|池|湖|河|溪|泉|瀑/i],
  ["flame", /fire|flame|candle|torch|brazier|hearth|fireplace|campfire|火|烛|蜡|炉|篝/i],
  ["flicker", /lantern|lamp|light|neon|灯|灯笼/i],
  ["twinkle", /star|crystal|gem|magic|sparkle|glitter|星|水晶|宝石|魔法|闪/i],
  ["pulse", /portal|glow|orb|rune|传送|光球|符文|发光/i],
  ["sway", /flower|garden|tree|leaf|leaves|plant|bush|grass|reed|flag|banner|curtain|花|园|树|叶|草|旗|帘|植物/i],
];

/** A default effect for an object, from its kind and words. Null = it stays still. */
export function defaultAmbientFor(o: Pick<WorldObject, "type" | "tags" | "label" | "id">): AmbientSpec | null {
  const words = [o.label ?? "", ...o.tags].join(" ");
  let kind: AmbientKind | null = null;
  for (const [k, re] of HINTS) if (re.test(words)) {
    kind = k;
    break;
  }
  if (!kind) kind = o.type === "portal" ? "pulse" : o.type === "light" ? "flicker" : o.type === "plant" ? "sway" : null;
  if (!kind) return null;
  // A stable per-object phase so two lanterns never flicker in unison.
  let h = 0;
  for (const ch of o.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ambientSpec(kind, { phase: (h % 1000) / 1000 });
}

/** Importance when there are more candidates than MAX_AMBIENT: light and water first, foliage last. */
const RANK: Record<AmbientKind, number> = { flame: 6, flicker: 5, pulse: 4, ripple: 4, twinkle: 3, sway: 2 };

export type AmbientItem = { objectId: string; spec: AmbientSpec };

/**
 * Which objects animate in this scene: the object's own spec if it has one
 * (null/disabled = none), otherwise a default (built-in rooms, older maps).
 * Hidden objects and gifts never animate. Capped at MAX_AMBIENT.
 */
export function ambientFor(objects: WorldObject[], limit = MAX_AMBIENT): AmbientItem[] {
  const out: AmbientItem[] = [];
  for (const o of objects) {
    if (o.giftId || o.marker || o.hidden) continue;
    const spec = o.ambient === undefined ? defaultAmbientFor(o) : o.ambient;
    if (!spec || !spec.enabled || !spec.visible) continue;
    out.push({ objectId: o.id, spec });
  }
  return out.sort((a, b) => RANK[b.spec.kind] - RANK[a.spec.kind]).slice(0, limit);
}

/** CSS timing for an effect: duration from speed, a negative delay from phase (starts mid-loop, no sync). */
export function ambientTiming(spec: AmbientSpec): { duration: number; delay: number; steps: number; direction: "normal" | "alternate" } {
  const t = AMBIENT_TEMPO[spec.kind];
  const duration = Math.round(t.ms / spec.speed);
  return { duration, delay: -Math.round(duration * spec.phase), steps: t.steps, direction: spec.loop === "alternate" ? "alternate" : "normal" };
}
