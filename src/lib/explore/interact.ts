/**
 * OBJECT INTERACTIONS — what using an object actually DOES (pure, unit-tested).
 * --------------------------------------------------------------------------
 * A character never just "looks at" a door: they open it, find it locked,
 * close it again, unlock it with a key, or step through it. Whether that
 * worked is decided HERE, by game rules and the object's saved state, never
 * by AI prose. The play screen walks the character to a valid interaction
 * point first (stage/sim.ts), then asks this module for the outcome and
 * applies it: a state change (door open → its collider no longer blocks),
 * an animation, a pose, a narration line, and maybe a follow-up:
 *
 *   talk   start a conversation with the counter's keeper (the bartender)
 *   exit   the action leads out of this scene → "Leave this area?"
 *   place  put a carried item down on this table
 *
 * Every object kind has its own actions (objects.ts ACTIONS_BY_TYPE), and
 * `availability()` says which of them make sense right now, with a reason
 * for the ones that don't (shown greyed out in the action menu).
 */
import type { ObjectAction, WorldObject } from "../stage/objects";

/** The live state of one object, saved per scene in the world save. */
export type ObjectState = {
  open?: boolean;
  locked?: boolean;
  /** How many times it's been used, and by whom last (for variety and the log). */
  uses?: number;
  lastBy?: string;
  /** Chest: the contents were found (taken note of). */
  searched?: boolean;
};

export type Anim = "climb" | "push" | "rattle" | "knock" | "lean" | "read" | "search" | "rest" | "reach";

export type Unavailable = "locked" | "no_key" | "no_keeper" | "closed" | "nothing_to_place" | "not_owner" | "already_open" | "already_closed" | "not_an_exit";

export type Availability = { action: ObjectAction; ok: true } | { action: ObjectAction; ok: false; reason: Unavailable };

export type InteractContext = {
  actorId: string;
  /** Items the actor carries (gifts with display "carried"), for keys and placing things. */
  carrying: { id: string; name: string }[];
  /** The counter's keeper on stage right now (resolved by the caller), or null. */
  keeperId: string | null;
  /** Where this exit leads, if it's already connected. */
  destination: string | null;
  /**
   * Who asked. Autonomous rules ("auto") never leave the scene or open the
   * player's conversation window; the player ("player") and genuine plans
   * from dialogue ("story") can.
   */
  priority: "player" | "story" | "auto";
};

export type Outcome = {
  ok: boolean;
  /** Narration, as an i18n template under explore.do (+ params filled by the caller: name, object). */
  line: { tpl: string; params?: Record<string, string> };
  patch?: Partial<ObjectState>;
  anim?: Anim;
  pose?: "sit" | null;
  follow?: { kind: "talk"; target: string } | { kind: "exit" } | { kind: "place"; itemId: string };
};

/** State before anyone touched it (from the object's own settings). */
export function initialState(o: WorldObject): ObjectState {
  return { open: !!o.startsOpen, locked: !!o.locked && !o.startsOpen };
}

export function stateOf(o: WorldObject, saved: ObjectState | undefined): ObjectState {
  return { ...initialState(o), ...(saved ?? {}) };
}

/** Does the actor carry something that fits this lock? */
export function keyFor(o: WorldObject, carrying: InteractContext["carrying"]): { id: string; name: string } | null {
  const want = (o.keyName ?? "").toLowerCase().trim();
  const words = want ? [want] : ["key", "钥匙"];
  return carrying.find((c) => words.some((w) => c.name.toLowerCase().includes(w))) ?? null;
}

const LEAVING: ObjectAction[] = ["leave", "enter"];

/**
 * Which actions make sense right now, best first. Actions that make no sense
 * at all in this state (closing a closed door, knocking on an open one) are
 * left out; ones that are blocked (opening a locked door) are kept with the
 * reason, so the menu can say why.
 */
export function availability(o: WorldObject, s: ObjectState, ctx: InteractContext): Availability[] {
  const out: Availability[] = [];
  const add = (action: ObjectAction, reason: Unavailable | null = null) => {
    if (!o.actions.includes(action) || out.some((x) => x.action === action)) return;
    out.push(reason ? { action, ok: false, reason } : { action, ok: true });
  };
  const opens = o.type === "door" || o.type === "chest";
  for (const a of o.actions) {
    switch (a) {
      case "open":
        if (!opens) add(a);
        else if (!s.open) add(a, s.locked ? "locked" : null);
        break;
      case "close":
        if (s.open) add(a);
        break;
      case "knock":
        if (o.type === "door" && !s.open && s.locked) add(a);
        break;
      case "unlock":
        if (s.locked) add(a, keyFor(o, ctx.carrying) ? null : "no_key");
        break;
      case "leave":
      case "enter":
        if (!o.exit) break;
        if (ctx.priority === "auto") break;
        add(a, o.type === "door" && s.locked && !s.open ? "locked" : null);
        break;
      case "climb":
        add(a);
        break;
      case "talk":
      case "order":
        add(a, ctx.keeperId ? null : "no_keeper");
        break;
      case "search":
        add(a, o.type === "chest" && !s.open ? (s.locked ? "locked" : "closed") : null);
        break;
      case "place":
        add(a, ctx.carrying.length ? null : "nothing_to_place");
        break;
      case "pick_up":
        add(a, o.type === "gift" && o.ownerId !== ctx.actorId ? "not_owner" : null);
        break;
      default:
        add(a);
    }
  }
  // An exit door: once it's open, stepping through comes first.
  if (o.type === "door" && o.exit && s.open) out.sort((x, y) => Number(y.action === "leave") - Number(x.action === "leave"));
  return out;
}

/** The first action that's possible right now (what a plain drag onto the object does when there's only one). */
export function bestAction(o: WorldObject, s: ObjectState, ctx: InteractContext): ObjectAction | null {
  return availability(o, s, ctx).find((a) => a.ok)?.action ?? null;
}

const p = (params: Record<string, string> = {}) => params;

/**
 * Carry out `action` on the object (the character is already standing at it).
 * Re-checks the state, because it may have changed during the walk.
 */
export function resolve(o: WorldObject, action: ObjectAction, s: ObjectState, ctx: InteractContext): Outcome {
  const note = o.description?.trim() ?? "";
  const leaves = !!o.exit && ctx.priority !== "auto";
  const uses = { uses: (s.uses ?? 0) + 1, lastBy: ctx.actorId };
  switch (action) {
    case "open": {
      if (o.type !== "door" && o.type !== "chest") return { ok: true, line: { tpl: "explore.do.openOther" }, anim: "reach", patch: uses };
      if (s.open) return o.type === "door" && leaves ? { ok: true, line: { tpl: "explore.do.throughDoor" }, follow: { kind: "exit" } } : { ok: false, line: { tpl: "explore.do.alreadyOpen" } };
      if (s.locked) return { ok: false, line: { tpl: "explore.do.locked" }, anim: "rattle" };
      if (o.type === "chest") return { ok: true, line: { tpl: o.contents?.length ? "explore.do.chestOpenFull" : "explore.do.chestOpen" }, anim: "push", patch: { ...uses, open: true } };
      return { ok: true, line: { tpl: leaves ? "explore.do.doorOpenExit" : "explore.do.doorOpen" }, anim: "push", patch: { ...uses, open: true }, follow: leaves ? { kind: "exit" } : undefined };
    }
    case "close":
      if (!s.open) return { ok: false, line: { tpl: "explore.do.alreadyClosed" } };
      return { ok: true, line: { tpl: "explore.do.close" }, anim: "push", patch: { ...uses, open: false } };
    case "knock":
      return { ok: true, line: { tpl: "explore.do.knock" }, anim: "knock", patch: uses };
    case "unlock": {
      if (!s.locked) return { ok: false, line: { tpl: "explore.do.alreadyUnlocked" } };
      const key = keyFor(o, ctx.carrying);
      if (!key) return { ok: false, line: { tpl: "explore.do.noKey" }, anim: "rattle" };
      return { ok: true, line: { tpl: "explore.do.unlock", params: p({ item: key.name }) }, anim: "reach", patch: { ...uses, locked: false } };
    }
    case "leave":
    case "enter": {
      if (!leaves) return { ok: false, line: { tpl: "explore.do.notAnExit" } };
      if (o.type === "door" && !s.open) {
        if (s.locked) return { ok: false, line: { tpl: "explore.do.locked" }, anim: "rattle" };
        return { ok: true, line: { tpl: "explore.do.doorOpenExit" }, anim: "push", patch: { ...uses, open: true }, follow: { kind: "exit" } };
      }
      return { ok: true, line: { tpl: action === "enter" ? "explore.do.portal" : "explore.do.leave" }, anim: action === "enter" ? "reach" : undefined, patch: uses, follow: { kind: "exit" } };
    }
    case "climb":
      return leaves
        ? { ok: true, line: { tpl: "explore.do.climbExit" }, anim: "climb", patch: uses, follow: { kind: "exit" } }
        : { ok: true, line: { tpl: "explore.do.climbStay" }, anim: "climb", patch: uses };
    case "talk":
      if (!ctx.keeperId) return { ok: false, line: { tpl: "explore.do.noKeeper" }, anim: "lean" };
      if (ctx.priority === "auto") return { ok: true, line: { tpl: "explore.do.chatKeeper" }, anim: "lean", patch: uses };
      return { ok: true, line: { tpl: "explore.do.callKeeper" }, anim: "lean", patch: uses, follow: { kind: "talk", target: ctx.keeperId } };
    case "order":
      if (!ctx.keeperId) return { ok: false, line: { tpl: "explore.do.noKeeper" }, anim: "lean" };
      return { ok: true, line: { tpl: "explore.do.order" }, anim: "lean", patch: uses };
    case "sit":
      return { ok: true, line: { tpl: o.type === "bed" ? "explore.do.sitBed" : "objects.do.sit" }, pose: "sit", patch: uses };
    case "rest":
      return { ok: true, line: { tpl: "explore.do.rest" }, pose: "sit", anim: "rest", patch: uses };
    case "browse":
      return { ok: true, line: { tpl: "explore.do.browse" }, anim: "read", patch: uses };
    case "read":
      if (o.type === "sign") return { ok: true, line: note ? { tpl: "explore.do.signText", params: p({ text: note }) } : { tpl: "explore.do.signFaded" }, patch: uses };
      return { ok: true, line: note ? { tpl: "explore.do.readText", params: p({ text: note }) } : { tpl: "objects.do.read" }, anim: "read", patch: uses };
    case "search": {
      if (o.type === "chest" && !s.open) return { ok: false, line: { tpl: s.locked ? "explore.do.locked" : "explore.do.chestClosed" }, anim: s.locked ? "rattle" : undefined };
      const found = o.contents?.length ? o.contents.join(", ") : "";
      return { ok: true, line: found ? { tpl: "explore.do.found", params: p({ text: found }) } : { tpl: "explore.do.empty" }, anim: "search", patch: { ...uses, searched: true } };
    }
    case "place": {
      const item = ctx.carrying[0];
      if (!item) return { ok: false, line: { tpl: "explore.do.nothingToPlace" } };
      return { ok: true, line: { tpl: "explore.do.place", params: p({ item: item.name }) }, anim: "reach", patch: uses, follow: { kind: "place", itemId: item.id } };
    }
    case "examine":
    case "inspect":
    case "look_out":
    case "admire":
    case "pick_up":
      if (note && action !== "pick_up" && action !== "admire") return { ok: true, line: { tpl: "explore.do.noteLook", params: p({ text: note }) }, patch: uses };
      return { ok: true, line: { tpl: `objects.do.${action}` }, patch: uses };
  }
}

/** Actions that can take a character out of the scene. */
export const leavesScene = (action: ObjectAction) => LEAVING.includes(action) || action === "climb" || action === "open";

/**
 * The counter's keeper: the one set in the play area editor if they're here,
 * otherwise whoever stands right behind (or beside) the counter.
 */
export function keeperOf(o: WorldObject, present: { id: string; x: number; y: number }[], exclude: string): string | null {
  if (o.type !== "counter") return null;
  if (o.keeper && present.some((c) => c.id === o.keeper) && o.keeper !== exclude) return o.keeper;
  const b = o.bounds;
  const pad = 18;
  const near = present
    .filter((c) => c.id !== exclude && c.x >= b.x0 - pad && c.x <= b.x1 + pad && c.y >= b.y0 - pad && c.y <= b.y1 + 4)
    // Behind the counter (smaller y = further back) is the most likely bartender.
    .sort((a, c) => a.y - c.y);
  return near[0]?.id ?? null;
}
