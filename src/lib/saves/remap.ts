/**
 * Duplicating a world: give the copy its own character and map ids and
 * rewrite every reference to them, so nothing in the copy points back at the
 * original. Pure functions (no storage), so they are easy to test.
 *
 * References can sit anywhere in the world data: as values (memory.withId,
 * event.actorId, a log line's speaker id, environment.mapId…) or inside keys
 * (story.characters[id], bonds "a|b", relations "a>b"…). The walk below
 * rewrites both, matching whole ids only (never part of a longer word).
 */

const SEPARATORS = /([|>])/;

function remapToken(s: string, ids: ReadonlyMap<string, string>): string {
  const direct = ids.get(s);
  if (direct !== undefined) return direct;
  if (!SEPARATORS.test(s) || s.length > 400) return s;
  const parts = s.split(SEPARATORS);
  let changed = false;
  for (let i = 0; i < parts.length; i += 2) {
    const next = ids.get(parts[i]);
    if (next !== undefined) {
      parts[i] = next;
      changed = true;
    }
  }
  if (!changed) return s;
  // Bond keys ("a|b") are stored with the two ids in sorted order: keep that rule.
  if (parts.length === 3 && parts[1] === "|" && parts[0] > parts[2]) return `${parts[2]}|${parts[0]}`;
  return parts.join("");
}

/** Deep copy of `value` with every id in `ids` replaced. Never mutates the input. */
export function remapIds<T>(value: T, ids: ReadonlyMap<string, string>): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return remapToken(v, ids);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) out[remapToken(k, ids)] = walk(child);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/** Old → new ids for every character in raw world data. */
export function characterIdMap(raw: unknown, newId: () => string): Map<string, string> {
  const ids = new Map<string, string>();
  const chars = (raw as { characters?: unknown } | null)?.characters;
  if (Array.isArray(chars)) {
    for (const c of chars) {
      const id = (c as { id?: unknown } | null)?.id;
      if (typeof id === "string" && id && !ids.has(id)) ids.set(id, newId());
    }
  }
  return ids;
}
