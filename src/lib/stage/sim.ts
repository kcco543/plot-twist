/**
 * STAGE SIMULATION — positions, movement and the character state machine.
 * --------------------------------------------------------------------------
 * Pure TypeScript (no React, no timers): the play screen calls tick(dt) every
 * animation frame, tests call it with fixed steps. Time only advances in
 * tick(), so pausing the game freezes everyone mid-step.
 *
 * Each character is in exactly one state:
 *
 *   IDLE ─▶ MOVING ─▶ INTERACTING ─▶ SPEAKING ─▶ REACTING ─▶ IDLE
 *
 * See TRANSITIONS for every allowed change. Anything else is refused, which
 * is what prevents conflicting states and animation loops. A walk that gets
 * interrupted (by speaking, a reaction or Stop) is kept as "suspended" and
 * resumes from where the character is now.
 */
import type { Character } from "../types";
import { type Emotion, type EmotionLevel } from "../emotion/emotions";
import { burstMs, effectFor, type BodyMotion } from "../emotion/effects";
import { PRIORITIES, travels, validateStageAction, type ActionResult, type IdleKind, type Priority, type StageAction } from "./actions";
import { actionAllowed, defaultAction, validAnchors, type ObjectAction, type WorldObject } from "./objects";
import { idleChoice, idleDelay, reactionAction, rngFrom, walkSpeed, type MoveContext } from "./behavior";
import { clampToWalk, gap, roomSize, PERSONAL_SPACE, STAND_DEPTH, standGap, type Point, type RoomLayout } from "./room";
import { findPath, isFree, nearestFree, PASSING_SPACE, spawnPoints, type Blocker } from "./path";
import type { Bond } from "../types";

export const ACTOR_STATES = ["idle", "moving", "interacting", "speaking", "reacting"] as const;
export type ActorState = (typeof ACTOR_STATES)[number];

/** Allowed state changes. Same-state "changes" are no-ops, never restarts. */
export const TRANSITIONS: Record<ActorState, readonly ActorState[]> = {
  idle: ["moving", "interacting", "speaking", "reacting"],
  moving: ["idle", "interacting", "speaking", "reacting"],
  interacting: ["idle", "moving", "speaking", "reacting"],
  // Finish the sentence before walking off.
  speaking: ["idle", "interacting", "reacting"],
  reacting: ["idle", "moving", "interacting", "speaking"],
};
export const canTransition = (from: ActorState, to: ActorState) => TRANSITIONS[from].includes(to);

/** How long the "reacting" beat lasts (body motion), ms. */
export const REACT_MS = 700;
/** After arriving next to someone, stay "interacting" this long (unless a conversation keeps it going). */
export const INTERACT_MS = 2500;
/** A blocked walker waits this long before looking for another way. */
const BLOCKED_REPLAN_MS = 350;
const MAX_REPLANS = 4;
/** An emotion can trigger a reaction MOVE at most this often per character (rapid changes only update the effect). */
export const REACT_MOVE_COOLDOWN = 1500;
/** Approaching a moving target re-aims at most this often. */
const RETARGET_MS = 500;
/** After a player-commanded walk ends, autonomous behavior leaves that character's position alone this long. */
export const COMMAND_GRACE_MS = 2500;

type Move = {
  kind: "approach" | "retreat" | "shift" | "makeRoom" | "goto" | "object";
  /** kind "object": what to use and how. */
  objectId?: string;
  action?: ObjectAction;
  targetId: string | null;
  /** For approach: stop this far from the target. For retreat: how far to get away. */
  distance: number;
  goal: Point;
  path: Point[];
  speed: number;
  blockedMs: number;
  replans: number;
  aimedAt: Point | null;
  aimedMs: number;
};

type Actor = {
  id: string;
  c: Character;
  x: number;
  y: number;
  facing: 1 | -1;
  state: ActorState;
  since: number;
  move: Move | null;
  suspended: Move | null;
  /** Action to run once the current reaction ends. */
  queued: StageAction | null;
  lookAt: string | null;
  emotion: Emotion;
  level: EmotionLevel;
  /** Sim time the current emotion's burst started (effects key off it). */
  burstAt: number;
  /** External stamp of the emotion (story state), to tell a new one from a re-sync. */
  emotionStamp: number;
  body: BodyMotion | IdleKind | null;
  bodyAt: number;
  bodyUntil: number;
  reactUntil: number;
  interactUntil: number;
  lastReactMoveAt: number;
  nextIdleAt: number;
  idleSeq: number;
  /** Turn head the other way briefly (look around). */
  glanceUntil: number;
  /** Priority of the current / paused walk. */
  movePriority: number;
  /** Until when autonomous movement must leave this character alone (player command). */
  commandUntil: number;
  /** Sitting on something (cleared when they walk again). */
  pose: "sit" | null;
  /** The object they're using right now, if any. */
  usingObject: string | null;
};

export type ActorView = {
  id: string;
  x: number;
  y: number;
  facing: 1 | -1;
  state: ActorState;
  emotion: Emotion;
  level: EmotionLevel;
  /** Changes whenever a new emotion burst starts. */
  burstKey: number;
  /** The burst is still playing (full particles); afterwards the effect is quiet. */
  bursting: boolean;
  body: BodyMotion | IdleKind | null;
  bodyKey: number;
  walking: boolean;
  /** Paused walk waiting to resume. */
  suspended: boolean;
  lookAt: string | null;
  pose: "sit" | null;
  usingObject: string | null;
};

/** Where a character stands, saved with the world so a reload puts everyone back. */
export type SavedSpot = { x: number; y: number; facing: 1 | -1; pose?: "sit" | null; object?: string | null };

export type StageSnapshot = { actors: ActorView[]; paused: boolean; time: number };

export type SimOptions = {
  room: RoomLayout;
  /** Reduced motion: no idle wandering, no body animation; walking still happens. */
  reducedMotion?: boolean;
  /** Idle animations on/off (tests turn them off for repeatability). */
  idle?: boolean;
  bondOf?: (a: string, b: string) => Bond;
};

/** Called when someone finishes walking up to someone else (the behavior engine reacts to it). */
export type ArriveListener = (actorId: string, targetId: string, priority: Priority) => void;
/** Called when someone reaches an object and uses it. */
export type ObjectListener = (actorId: string, objectId: string, action: ObjectAction, priority: Priority) => void;
/** Called when any walk ends: arrived, gave up (blocked), or was cancelled / replaced. */
export type WalkEndListener = (actorId: string, outcome: "arrived" | "failed" | "cancelled", kind: string, priority: Priority) => void;

export class StageSim {
  private actors = new Map<string, Actor>();
  private order: string[] = [];
  private time = 0;
  private listeners = new Set<() => void>();
  private snap: StageSnapshot = { actors: [], paused: false, time: 0 };
  private snapKey = "";
  private convo = new Set<string>();
  private speakerId: string | null = null;
  room: RoomLayout;
  paused = false;
  reducedMotion: boolean;
  idle: boolean;
  bondOf: (a: string, b: string) => Bond;
  /** Last result per character, for the test panel. */
  lastResult = new Map<string, ActionResult>();
  /** Requests waiting for a delay (game time, so pausing freezes them too). */
  private scheduled: { at: number; raw: unknown; context: MoveContext; priority: Priority }[] = [];
  onArrive: ArriveListener | null = null;
  onObject: ObjectListener | null = null;
  onWalkEnd: WalkEndListener | null = null;
  /** Interactive objects in this room (objects.ts). */
  objects: WorldObject[] = [];
  /** Saved spots to put characters back on when they're (re)added. */
  private savedSpots: Record<string, SavedSpot> = {};
  private pendingPriority: number = PRIORITIES.story;

  /** Run a request after `delayMs` of game time (a hesitation before reacting). */
  schedule(delayMs: number, raw: unknown, context: MoveContext = "event", priority: Priority = "story") {
    if (delayMs <= 0) return this.request(raw, context, priority);
    this.scheduled.push({ at: this.time + delayMs, raw, context, priority });
    return null;
  }

  /** Is the player directly controlling this character's movement right now? */
  isCommanded(id: string): boolean {
    const a = this.actors.get(id);
    return !!a && this.time < a.commandUntil;
  }

  /** Floor gap between two characters (null if either is missing). */
  gapBetween(a: string, b: string): number | null {
    const x = this.actors.get(a);
    const y = this.actors.get(b);
    return x && y ? standGap(x, y) : null;
  }

  /** Is there a walkable way to stand next to `target`? (used to reject unreachable approaches before choosing) */
  canReach(actorId: string, targetId: string, distance = 30): boolean {
    const a = this.actors.get(actorId);
    const t = this.actors.get(targetId);
    if (!a || !t) return false;
    if (standGap(a, t) <= distance + 4) return true;
    const goal = this.approachGoal(a, t, distance);
    return !!goal && !!this.plan(a, goal);
  }

  /**
   * Drag preview: the route `actorId` would walk to stand `distance` from
   * `targetId` (same planner and collision rules as a real walk). [] when
   * they are already close enough, null when there is no way to get there.
   */
  previewApproach(actorId: string, targetId: string, distance = 30, opts: { ignorePeople?: boolean } = {}): Point[] | null {
    const a = this.actors.get(actorId);
    const t = this.actors.get(targetId);
    if (!a || !t || a === t) return null;
    if (standGap(a, t) <= distance + 4) return [];
    const goal = this.approachGoal(a, t, distance);
    // ignorePeople: would the way be open if nobody were standing in it? (tells "a wall" from "someone in the way")
    return goal ? this.plan(a, goal, opts.ignorePeople ? [...this.actors.keys()] : []) : null;
  }

  /** The walk a character is on (or has paused), if any. */
  walkOf(id: string): { kind: Move["kind"]; targetId: string | null; objectId: string | null; goal: Point; paused: boolean; priority: Priority } | null {
    const a = this.actors.get(id);
    const m = a?.move ?? a?.suspended;
    return a && m ? { kind: m.kind, targetId: m.targetId, objectId: m.objectId ?? null, goal: m.goal, paused: !a.move, priority: this.priorityName(a.movePriority) } : null;
  }

  /** Drop one character's walk for good (the player cancelled it). Unlike stop(), it won't resume. */
  cancelWalk(id: string): boolean {
    const a = this.actors.get(id);
    if (!a || (!a.move && !a.suspended)) return false;
    const m = a.move ?? a.suspended;
    const priority = this.priorityName(a.movePriority);
    a.move = null;
    a.suspended = null;
    this.endCommand(a);
    if (m) this.onWalkEnd?.(a.id, "cancelled", m.kind, priority);
    if (a.state === "moving") this.setState(a, this.convo.has(a.id) ? "interacting" : "idle");
    this.emit();
    return true;
  }

  constructor(opts: SimOptions) {
    this.room = opts.room;
    this.reducedMotion = !!opts.reducedMotion;
    this.idle = opts.idle ?? true;
    this.bondOf = opts.bondOf ?? (() => ({ affinity: 0, trust: 0 }));
  }

  // ------------------------------------------------------------ cast + room

  /** Add / update / remove characters by id. Existing characters keep their place. */
  setCast(cast: Character[]) {
    const ids = cast.map((c) => c.id);
    for (const id of [...this.actors.keys()]) if (!ids.includes(id)) this.actors.delete(id);
    const fresh = cast.filter((c) => !this.actors.has(c.id));
    if (fresh.length) {
      const spots = spawnPoints(this.room, cast.length);
      cast.forEach((c, i) => {
        if (this.actors.has(c.id)) return;
        const others = [...this.actors.values()].map((a) => ({ x: a.x, y: a.y, depth: STAND_DEPTH }));
        const saved = this.savedSpots[c.id];
        const want = saved && isFree(this.room, saved, others, PERSONAL_SPACE - 2) ? { x: saved.x, y: saved.y } : spots[i];
        const p = isFree(this.room, want, others, PERSONAL_SPACE - 2) ? want : (nearestFree(this.room, want, others, PERSONAL_SPACE, 160) ?? want);
        const rng = rngFrom(`idle:${c.id}`);
        this.actors.set(c.id, {
          id: c.id,
          c,
          x: p.x,
          y: p.y,
          facing: saved && p.x === saved.x && p.y === saved.y ? saved.facing : p.x > roomSize(this.room).width / 2 ? -1 : 1,
          state: "idle",
          since: this.time,
          move: null,
          suspended: null,
          queued: null,
          lookAt: null,
          emotion: "neutral",
          level: 1,
          burstAt: -1e9,
          emotionStamp: -1,
          body: null,
          bodyAt: 0,
          bodyUntil: 0,
          reactUntil: 0,
          interactUntil: 0,
          lastReactMoveAt: -1e9,
          nextIdleAt: this.time + 2500 + idleDelay(c, rng) / 2,
          idleSeq: 0,
          glanceUntil: 0,
          movePriority: 0,
          commandUntil: 0,
          pose: saved && p.x === saved.x && p.y === saved.y ? (saved.pose ?? null) : null,
          usingObject: saved && p.x === saved.x && p.y === saved.y ? (saved.object ?? null) : null,
        });
      });
    }
    for (const c of cast) this.actors.get(c.id)!.c = c;
    this.order = ids;
    this.emit(true);
  }

  /** Saved positions (from the world save) used for characters added from now on. */
  setSavedSpots(spots: Record<string, SavedSpot>) {
    this.savedSpots = spots;
  }

  /** Everyone's current spot (for saving). Walkers are saved where they stand now. */
  spots(): Record<string, SavedSpot> {
    const out: Record<string, SavedSpot> = {};
    for (const a of this.actors.values()) out[a.id] = { x: Math.round(a.x), y: Math.round(a.y), facing: a.facing, pose: a.pose, object: a.usingObject };
    return out;
  }

  setObjects(objects: WorldObject[]) {
    this.objects = objects;
    for (const a of this.actors.values()) if (a.usingObject && !objects.some((o) => o.id === a.usingObject)) a.usingObject = null;
    this.emit(true);
  }
  objectById(id: string) {
    return this.objects.find((o) => o.id === id) ?? null;
  }

  /** New room (different place): everyone goes back to a starting spot. */
  /** Switch rooms (everyone is placed again). `spots` = where they stood last time in the new room. */
  setRoom(room: RoomLayout, spots: Record<string, SavedSpot> = {}) {
    if (room === this.room) return;
    this.room = room;
    this.savedSpots = spots;
    const cast = this.order.map((id) => this.actors.get(id)!.c);
    this.actors.clear();
    this.setCast(cast);
  }

  // ------------------------------------------------------------ subscription

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.snap;

  private emit(force = false) {
    const actors: ActorView[] = this.order
      .map((id) => this.actors.get(id))
      .filter((a): a is Actor => !!a)
      .map((a) => ({
        id: a.id,
        x: Math.round(a.x),
        y: Math.round(a.y),
        facing: this.time < a.glanceUntil ? ((-a.facing) as 1 | -1) : a.facing,
        state: a.state,
        emotion: a.emotion,
        level: a.level,
        burstKey: a.burstAt,
        bursting: this.time - a.burstAt < burstMs(a.emotion),
        body: this.time < a.bodyUntil ? a.body : null,
        bodyKey: a.bodyAt,
        walking: a.state === "moving",
        suspended: !!a.suspended,
        lookAt: a.lookAt,
        pose: a.pose,
        usingObject: a.usingObject,
      }));
    const key = JSON.stringify(actors) + this.paused;
    if (!force && key === this.snapKey) return;
    this.snapKey = key;
    this.snap = { actors, paused: this.paused, time: this.time };
    this.listeners.forEach((l) => l());
  }

  // ------------------------------------------------------------ queries

  get now() {
    return this.time;
  }
  position(id: string): Point | null {
    const a = this.actors.get(id);
    return a ? { x: a.x, y: a.y } : null;
  }
  stateOf(id: string): ActorState | null {
    return this.actors.get(id)?.state ?? null;
  }
  emotionOf(id: string): { emotion: Emotion; level: EmotionLevel } | null {
    const a = this.actors.get(id);
    return a ? { emotion: a.emotion, level: a.level } : null;
  }
  poseOf(id: string) {
    return this.actors.get(id)?.pose ?? null;
  }
  isSuspended(id: string) {
    return !!this.actors.get(id)?.suspended;
  }
  /** Closest other character (by floor distance). */
  nearest(id: string): string | null {
    const a = this.actors.get(id);
    if (!a) return null;
    let best: string | null = null;
    let bestD = Infinity;
    for (const b of this.actors.values()) {
      if (b.id === id) continue;
      const d = gap(a, b);
      if (d < bestD) {
        bestD = d;
        best = b.id;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ state machine

  private setState(a: Actor, to: ActorState): boolean {
    if (a.state === to) return true;
    if (!canTransition(a.state, to)) return false;
    a.state = to;
    a.since = this.time;
    if (to === "idle") a.nextIdleAt = Math.max(a.nextIdleAt, this.time + 1500);
    return true;
  }

  /** Where a character settles when nothing else is going on. */
  private settle(a: Actor) {
    if (a.suspended && a.state !== "speaking" && this.resumeMove(a)) return;
    this.setState(a, this.convo.has(a.id) || this.time < a.interactUntil ? "interacting" : "idle");
  }

  // ------------------------------------------------------------ actions

  /**
   * Validate and run one action (from rules, the test panel, or later an AI).
   * Priority defaults to "player" for the test panel and "story" otherwise.
   */
  request(raw: unknown, context: MoveContext = "test", priority: Priority = context === "test" ? "player" : "story"): ActionResult {
    if (this.paused) return { ok: false, reason: "paused" };
    const v = validateStageAction(raw, {
      onStage: (id) => this.actors.has(id),
      stateOf: (id) => this.stateOf(id),
      objectOk: (actor, objectId, action) => {
        const o = this.objectById(objectId);
        if (!o) return "unknown_object";
        const act = (action as ObjectAction | undefined) ?? defaultAction(o, actor);
        return act && actionAllowed(o, act, actor) ? "ok" : "not_allowed";
      },
    });
    if (!v.ok) {
      if (v.action) this.lastResult.set(v.action.actor, v);
      return v;
    }
    const a0 = this.actors.get(v.action.actor)!;
    const rank = PRIORITIES[priority];
    const moves = travels(v.action);
    if (moves && rank < PRIORITIES.player && this.time < a0.commandUntil) {
      const r: ActionResult = { ok: false, reason: "player_command", action: v.action };
      this.lastResult.set(v.action.actor, r);
      return r;
    }
    if (moves && (a0.move || a0.suspended) && rank < a0.movePriority) {
      const r: ActionResult = { ok: false, reason: "outranked", action: v.action };
      this.lastResult.set(v.action.actor, r);
      return r;
    }
    this.pendingPriority = rank;
    const res = this.execute(v.action, context);
    this.pendingPriority = PRIORITIES.story;
    this.lastResult.set(v.action.actor, res);
    this.emit();
    return res;
  }

  private execute(act: StageAction, context: MoveContext): ActionResult {
    const a = this.actors.get(act.actor)!;
    switch (act.type) {
      case "face_target": {
        a.lookAt = act.target;
        if (a.state !== "moving") this.faceToward(a, this.actors.get(act.target)!);
        return { ok: true, action: act, note: "facing" };
      }
      case "idle_reaction":
        return this.idleReaction(a, act.kind, act);
      case "show_emotion": {
        this.applyEmotion(a, act.emotion, (act.level ?? 2) as EmotionLevel, true);
        if (act.react) {
          const target = act.target ? this.actors.get(act.target)!.c : null;
          const follow = this.time - a.lastReactMoveAt >= REACT_MOVE_COOLDOWN
            ? reactionAction(a.c, act.emotion, (act.level ?? 2) as EmotionLevel, target, target ? this.bondOf(a.id, target.id) : { affinity: 0, trust: 0 }, target ? context : "solo", rngFrom(`${a.id}:${act.emotion}:${Math.floor(this.time / 1000)}`))
            : null;
          if (follow) {
            a.lastReactMoveAt = this.time;
            if (a.state === "reacting") a.queued = follow;
            else this.request(follow, context);
          }
        }
        return { ok: true, action: act, note: "emoting" };
      }
      case "approach":
        return this.startApproach(a, act.target, act.distance ?? 30, act);
      case "retreat":
        return this.startRetreat(a, act.from ?? null, act.distance ?? 24, act);
      case "walk_to":
        return this.startGoto(a, { x: act.x, y: act.y }, act);
      case "use_object": {
        const o = this.objectById(act.object)!;
        return this.startObject(a, o, act.action ?? defaultAction(o, a.id)!, act);
      }
      case "turn_away": {
        const from = this.actors.get(act.from)!;
        a.lookAt = null;
        a.facing = from.x > a.x ? -1 : 1;
        a.glanceUntil = 0;
        return { ok: true, action: act, note: "facing" };
      }
      case "stand_up":
        a.pose = null;
        a.usingObject = null;
        return { ok: true, action: act, note: "idle" };
    }
  }

  private faceToward(a: Actor, b: Actor | Point) {
    const dx = b.x - a.x;
    if (Math.abs(dx) >= 1) a.facing = dx > 0 ? 1 : -1;
  }

  private blockersFor(a: Actor, exclude: string[] = [], space = PASSING_SPACE): Blocker[] {
    return [...this.actors.values()].filter((b) => b.id !== a.id && !exclude.includes(b.id)).map((b) => ({ x: b.x, y: b.y, space }));
  }

  /**
   * Everyone else, as places nobody may STAND next to (personal space, depth
   * barely counts). Spots other walkers are heading for count as taken too,
   * so two people never pick the same spot.
   */
  private standBlockers(a: Actor): Blocker[] {
    const out: Blocker[] = [];
    for (const b of this.actors.values()) {
      if (b.id === a.id) continue;
      out.push({ x: b.x, y: b.y, space: PERSONAL_SPACE, depth: STAND_DEPTH });
      const goal = (b.move ?? b.suspended)?.goal;
      if (goal) out.push({ x: goal.x, y: goal.y, space: PERSONAL_SPACE, depth: STAND_DEPTH });
    }
    return out;
  }

  /** Stand-spots `dist` from the target, nearest to the walker first. */
  private approachGoal(a: Actor, t: Actor, dist: number): Point | null {
    const side = a.x <= t.x ? -1 : 1;
    const others = this.standBlockers(a);
    const cands: Point[] = [];
    for (const s of [side, -side])
      for (const dy of [0, -4, 4, -8, 8]) cands.push(clampToWalk(this.room, { x: t.x + s * dist, y: t.y + dy }));
    for (const p of cands) {
      if (standGap(p, t) < dist - 6) continue; // clamped against a wall, too close
      if (isFree(this.room, p, others, PERSONAL_SPACE)) return p;
    }
    // Nothing exactly at that distance: nearest free spot that still keeps personal space.
    const p = nearestFree(this.room, { x: t.x + side * dist, y: t.y }, others, PERSONAL_SPACE, 24);
    return p && standGap(p, t) >= PERSONAL_SPACE ? p : null;
  }

  private plan(a: Actor, goal: Point, exclude: string[] = []): Point[] | null {
    return findPath(this.room, { x: a.x, y: a.y }, goal, this.blockersFor(a, exclude));
  }

  private beginMove(a: Actor, m: Move): boolean {
    const replaced = a.move ?? a.suspended;
    if (replaced && replaced !== m) this.onWalkEnd?.(a.id, "cancelled", replaced.kind, this.priorityName(a.movePriority));
    a.pose = null;
    a.usingObject = null;
    if (a.state === "reacting") {
      // Finish the reaction first, then walk.
      a.suspended = m;
      a.movePriority = this.pendingPriority;
      if (this.pendingPriority >= PRIORITIES.player) a.commandUntil = Infinity;
      return true;
    }
    if (!this.setState(a, "moving")) return false;
    a.move = m;
    a.suspended = null;
    a.lookAt = m.targetId;
    a.movePriority = this.pendingPriority;
    if (this.pendingPriority >= PRIORITIES.player) a.commandUntil = Infinity;
    return true;
  }

  private priorityName(rank: number): Priority {
    return rank >= PRIORITIES.player ? "player" : rank === PRIORITIES.auto ? "auto" : "story";
  }

  /**
   * Where to stand to reach `want`: the spot itself if it's free and has a path,
   * otherwise the nearest reachable free spot (ring search). null = no way at all.
   */
  private reachableNear(a: Actor, want: Point, maxRadius = 48): { goal: Point; path: Point[]; adjusted: boolean } | null {
    const others = this.standBlockers(a);
    const clamped = clampToWalk(this.room, want);
    if (isFree(this.room, clamped, others, PERSONAL_SPACE)) {
      const path = this.plan(a, clamped);
      if (path) return { goal: clamped, path, adjusted: Math.hypot(clamped.x - want.x, clamped.y - want.y) > 2 };
    }
    // Rings of candidates around the wanted spot, nearest first; the first one with a path wins.
    const cands: Point[] = [];
    for (let r = 4; r <= maxRadius; r += 4)
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2;
        cands.push({ x: Math.round(clamped.x + Math.cos(ang) * r), y: Math.round(clamped.y + Math.sin(ang) * r * 0.5) });
      }
    let tries = 0;
    for (const c of cands) {
      if (!isFree(this.room, c, others, PERSONAL_SPACE)) continue;
      if (++tries > 24) break;
      const path = this.plan(a, c);
      if (path) return { goal: c, path, adjusted: true };
    }
    return null;
  }

  /** Walk-to-point preview (drag): route + whether the spot had to be moved. null = can't get there. */
  previewGoto(actorId: string, p: Point): { path: Point[]; goal: Point; adjusted: boolean } | null {
    const a = this.actors.get(actorId);
    return a ? this.reachableNear(a, p) : null;
  }

  /** Object preview (drag): the anchor the actor would use and the route there. */
  previewObject(actorId: string, objectId: string): { path: Point[]; goal: Point; adjusted: boolean } | null {
    const a = this.actors.get(actorId);
    const o = this.objectById(objectId);
    return a && o ? this.objectGoal(a, o) : null;
  }

  private objectGoal(a: Actor, o: WorldObject): { path: Point[]; goal: Point; adjusted: boolean } | null {
    let best: { path: Point[]; goal: Point; adjusted: boolean; len: number } | null = null;
    for (const anchor of validAnchors(this.room, o)) {
      if (Math.hypot(a.x - anchor.x, a.y - anchor.y) <= o.radius) return { path: [], goal: { x: a.x, y: a.y }, adjusted: false };
      const r = this.reachableNear(a, anchor, 16);
      if (!r) continue;
      let len = 0;
      let prev: Point = a;
      for (const q of r.path) {
        len += Math.hypot(q.x - prev.x, q.y - prev.y);
        prev = q;
      }
      if (!best || len < best.len) best = { ...r, len };
    }
    return best ? { path: best.path, goal: best.goal, adjusted: best.adjusted } : null;
  }

  private startGoto(a: Actor, want: Point, act: StageAction): ActionResult {
    const r = this.reachableNear(a, want);
    if (!r) return { ok: false, reason: "no_path", action: act };
    if (!r.path.length) return { ok: true, action: act, note: "arrived" };
    const m: Move = { kind: "goto", targetId: null, distance: 0, goal: r.goal, path: r.path, speed: walkSpeed(a.c, a.emotion), blockedMs: 0, replans: 0, aimedAt: null, aimedMs: this.time };
    if (!this.beginMove(a, m)) return { ok: false, reason: "busy", action: act };
    a.lookAt = null;
    return { ok: true, action: act, note: r.adjusted ? "nearby" : "moving" };
  }

  private startObject(a: Actor, o: WorldObject, action: ObjectAction, act: StageAction): ActionResult {
    const r = this.objectGoal(a, o);
    if (!r) return { ok: false, reason: "no_path", action: act };
    const m: Move = { kind: "object", objectId: o.id, action, targetId: null, distance: 0, goal: r.goal, path: r.path, speed: walkSpeed(a.c, a.emotion), blockedMs: 0, replans: 0, aimedAt: null, aimedMs: this.time };
    if (!r.path.length) {
      // Already there: use it now.
      a.move = m;
      this.pendingMovePriority(a);
      this.arrive(a);
      return { ok: true, action: act, note: "arrived" };
    }
    if (!this.beginMove(a, m)) return { ok: false, reason: "busy", action: act };
    a.lookAt = null;
    return { ok: true, action: act, note: r.adjusted ? "nearby" : "moving" };
  }

  private pendingMovePriority(a: Actor) {
    a.movePriority = this.pendingPriority;
  }

  /** A walk ended (arrived, gave up or stopped): a player command keeps autonomy away a little longer. */
  private endCommand(a: Actor) {
    if (a.movePriority >= PRIORITIES.player) a.commandUntil = this.time + COMMAND_GRACE_MS;
    a.movePriority = 0;
  }

  private startApproach(a: Actor, targetId: string, distance: number, act: StageAction): ActionResult {
    const t = this.actors.get(targetId)!;
    a.lookAt = targetId;
    if (standGap(a, t) <= distance + 4) {
      if (a.state !== "moving") this.faceToward(a, t);
      a.interactUntil = this.time + INTERACT_MS;
      if (a.state === "idle") this.setState(a, "interacting");
      return { ok: true, action: act, note: "already_close" };
    }
    const goal = this.approachGoal(a, t, distance);
    if (!goal) return { ok: false, reason: "no_room", action: act };
    const path = this.plan(a, goal);
    if (!path) return { ok: false, reason: "no_path", action: act };
    const m: Move = { kind: "approach", targetId, distance, goal, path, speed: walkSpeed(a.c, a.emotion), blockedMs: 0, replans: 0, aimedAt: { x: t.x, y: t.y }, aimedMs: this.time };
    if (!this.beginMove(a, m)) return { ok: false, reason: "busy", action: act };
    return { ok: true, action: act, note: "moving" };
  }

  /** Step back from someone (or from the middle of the room), never leaving the floor. */
  private startRetreat(a: Actor, fromId: string | null, distance: number, act: StageAction): ActionResult {
    const mid = roomSize(this.room).width / 2;
    const from: Point = fromId ? this.actors.get(fromId)! : { x: mid, y: a.y };
    const dir = a.x === from.x ? (a.x < mid ? -1 : 1) : a.x < from.x ? -1 : 1;
    const others = this.standBlockers(a);
    const before = standGap(a, from);
    let best: Point | null = null;
    let shortened = false;
    // Straight back first, then a bit diagonal, then shorter steps.
    for (const k of [1, 0.75, 0.5])
      for (const dy of [0, -6, 6, -12, 12]) {
        if (best) break;
        const p = clampToWalk(this.room, { x: a.x + dir * distance * k, y: a.y + dy });
        if (standGap(p, from) < before + 6) continue;
        if (isFree(this.room, p, others, PERSONAL_SPACE) && this.plan(a, p)) {
          best = p;
          shortened = k < 1 || Math.abs(p.x - (a.x + dir * distance * k)) > 1;
        }
      }
    if (!best) {
      // Back against the wall: turn away instead of walking through it.
      a.facing = dir as 1 | -1;
      this.idleReaction(a, "shiver", act, true);
      return { ok: false, reason: "cornered", action: act };
    }
    const path = this.plan(a, best)!;
    const m: Move = { kind: "retreat", targetId: fromId, distance, goal: best, path, speed: walkSpeed(a.c, a.emotion) * 1.1, blockedMs: 0, replans: 0, aimedAt: null, aimedMs: this.time };
    if (!this.beginMove(a, m)) return { ok: false, reason: "busy", action: act };
    a.lookAt = fromId;
    return { ok: true, action: act, note: shortened ? "shortened" : "moving" };
  }

  private idleReaction(a: Actor, kind: IdleKind, act: StageAction, force = false): ActionResult {
    if (!force && (a.state === "moving" || a.state === "speaking")) return { ok: false, reason: "busy", action: act };
    if (kind === "shift") {
      if (this.reducedMotion) return { ok: true, action: act, note: "idle" };
      const rng = rngFrom(`${a.id}:shift:${a.idleSeq++}`);
      for (let i = 0; i < 6; i++) {
        const p = clampToWalk(this.room, { x: a.x + (rng() < 0.5 ? -1 : 1) * (6 + Math.round(rng() * 8)), y: a.y + Math.round((rng() - 0.5) * 8) });
        if (!isFree(this.room, p, this.standBlockers(a), PERSONAL_SPACE)) continue;
        const path = this.plan(a, p);
        if (!path) continue;
        const m: Move = { kind: "shift", targetId: null, distance: 0, goal: p, path, speed: walkSpeed(a.c, a.emotion) * 0.6, blockedMs: 0, replans: 0, aimedAt: null, aimedMs: this.time };
        if (this.beginMove(a, m)) return { ok: true, action: act, note: "moving" };
      }
      return { ok: true, action: act, note: "idle" };
    }
    if (kind === "look_around") a.glanceUntil = this.time + 700;
    a.body = kind;
    a.bodyAt = this.time;
    a.bodyUntil = this.time + (this.reducedMotion ? 0 : 900);
    return { ok: true, action: act, note: "idle" };
  }

  /** Set a feeling. `burst` replays the effect even if it's the same emotion. */
  private applyEmotion(a: Actor, emotion: Emotion, level: EmotionLevel, burst: boolean) {
    const changed = emotion !== a.emotion || level !== a.level;
    a.emotion = emotion;
    a.level = level;
    if (!changed && !burst) return;
    a.burstAt = this.time;
    if (emotion === "neutral") return;
    // REACTING: a short body motion. Someone mid-sentence keeps talking (effect only).
    const def = effectFor(emotion);
    if (a.state === "speaking") return;
    if (a.state === "moving" && a.move) {
      a.suspended = a.move;
      a.move = null;
    }
    if (this.setState(a, "reacting")) {
      a.reactUntil = this.time + REACT_MS;
      a.body = this.reducedMotion ? null : (def?.body ?? null);
      a.bodyAt = this.time;
      a.bodyUntil = this.reducedMotion ? 0 : this.time + REACT_MS;
    }
  }

  /** The caller already showed this emotion (e.g. the test panel): don't replay it when the story catches up. */
  markEmotionStamp(id: string, stamp: number) {
    const a = this.actors.get(id);
    if (a) a.emotionStamp = stamp;
  }

  /** Bring visuals in line with the story's emotions (after a beat, on load, after a language switch). */
  syncEmotion(id: string, emotion: Emotion, level: EmotionLevel, stamp: number) {
    const a = this.actors.get(id);
    if (!a || stamp === a.emotionStamp) return;
    const first = a.emotionStamp === -1;
    a.emotionStamp = stamp;
    if (first) {
      // On load: show the feeling quietly, no burst replay.
      a.emotion = emotion;
      a.level = level;
      this.emit();
      return;
    }
    this.applyEmotion(a, emotion, level, true);
    this.emit();
  }

  // ------------------------------------------------------------ conversation

  /** Characters in the current beat face each other and stay "interacting" until endConversation(). */
  beginConversation(ids: string[]) {
    this.convo = new Set(ids.filter((id) => this.actors.has(id)));
    for (const id of this.convo) {
      const a = this.actors.get(id)!;
      if (a.state === "idle") this.setState(a, "interacting");
    }
    this.emit();
  }

  endConversation() {
    const ids = [...this.convo];
    this.convo.clear();
    for (const id of ids) {
      const a = this.actors.get(id);
      if (a && a.state === "interacting" && this.time >= a.interactUntil) this.setState(a, "idle");
    }
    this.emit();
  }

  /** Who is talking right now (drives SPEAKING, and everyone else turns toward them). */
  setSpeaker(id: string | null) {
    if (id === this.speakerId) return;
    const prev = this.speakerId ? this.actors.get(this.speakerId) : null;
    this.speakerId = id;
    if (prev && prev.state === "speaking") {
      // Line finished: go back to what they were doing (a paused walk resumes).
      this.setState(prev, prev.suspended ? "idle" : this.convo.has(prev.id) ? "interacting" : "idle");
      if (prev.suspended) this.resumeMove(prev);
    }
    const a = id ? this.actors.get(id) : null;
    if (a) {
      if (a.state === "moving" && a.move) {
        a.suspended = a.move;
        a.move = null;
      }
      if (a.state === "reacting") a.reactUntil = this.time;
      this.setState(a, "speaking");
      const listener = a.lookAt && this.actors.get(a.lookAt) ? a.lookAt : this.nearest(a.id);
      if (listener) this.faceToward(a, this.actors.get(listener)!);
      for (const b of this.actors.values()) {
        if (b.id === a.id) continue;
        b.lookAt = a.id;
        if (b.state !== "moving") this.faceToward(b, a);
      }
    }
    this.emit();
  }

  // ------------------------------------------------------------ interrupt / resume

  /** Stop walking now; the walk can be resumed later. */
  stop(id: string): boolean {
    const a = this.actors.get(id);
    if (!a) return false;
    if (a.state === "moving" && a.move) {
      a.suspended = a.move;
      a.move = null;
      this.setState(a, this.convo.has(a.id) ? "interacting" : "idle");
      // A stopped player walk stays the player's: autonomy waits for the grace period.
      if (a.movePriority >= PRIORITIES.player) a.commandUntil = this.time + COMMAND_GRACE_MS;
      this.emit();
      return true;
    }
    return false;
  }

  /** Continue a stopped / interrupted walk, re-planned from where the character stands now. */
  resume(id: string): boolean {
    const a = this.actors.get(id);
    if (!a || !a.suspended) return false;
    const ok = this.resumeMove(a);
    this.emit();
    return ok;
  }

  private resumeMove(a: Actor): boolean {
    const m = a.suspended;
    if (!m) return false;
    a.suspended = null;
    this.pendingPriority = Math.max(a.movePriority, PRIORITIES.story);
    if (m.kind === "object" && m.objectId) {
      const o = this.objectById(m.objectId);
      if (!o || !m.action) return false;
      return this.startObject(a, o, m.action, { type: "use_object", actor: a.id, object: o.id, action: m.action }).ok;
    }
    if (m.kind === "approach" && m.targetId && this.actors.has(m.targetId)) {
      const res = this.startApproach(a, m.targetId, m.distance, { type: "approach", actor: a.id, target: m.targetId, distance: m.distance });
      return res.ok;
    }
    const path = this.plan(a, m.goal);
    if (!path) return false;
    return this.beginMove(a, { ...m, path, blockedMs: 0, replans: 0 });
  }

  /** Drop every walk, queued action and paused walk. */
  cancelAll() {
    for (const a of this.actors.values()) {
      a.queued = null;
      a.suspended = null;
      a.movePriority = 0;
      a.commandUntil = 0;
      if (a.state === "moving") {
        a.move = null;
        this.setState(a, "idle");
      }
    }
    this.emit();
  }

  setPaused(p: boolean) {
    if (this.paused === p) return;
    this.paused = p;
    this.emit(true);
  }

  // ------------------------------------------------------------ time

  tick(dtMs: number) {
    if (this.paused || dtMs <= 0) return;
    const dt = Math.min(dtMs, 100); // a background tab must not make anyone jump
    this.time += dt;
    if (this.scheduled.length) {
      const due = this.scheduled.filter((s) => s.at <= this.time);
      this.scheduled = this.scheduled.filter((s) => s.at > this.time);
      for (const s of due) this.request(s.raw, s.context, s.priority);
    }
    for (const id of this.order) {
      const a = this.actors.get(id);
      if (!a) continue;
      if (a.state === "reacting" && this.time >= a.reactUntil) {
        const q = a.queued;
        a.queued = null;
        this.setState(a, "idle");
        if (q) this.request(q, "event");
        if ((a.state as ActorState) === "idle") this.settle(a);
      }
      if (a.state === "interacting" && !this.convo.has(a.id) && this.time >= a.interactUntil && this.time - a.since > 300) this.setState(a, "idle");
      if (a.state === "moving") this.step(a, dt);
      if (a.state !== "moving" && a.lookAt) {
        const t = this.actors.get(a.lookAt);
        if (t && this.time >= a.glanceUntil) this.faceToward(a, t);
      }
      if (a.state === "idle" && this.idle && this.time >= a.nextIdleAt && !this.convo.size) {
        const rng = rngFrom(`${a.id}:idle:${a.idleSeq++}`);
        a.nextIdleAt = this.time + idleDelay(a.c, rng);
        a.lookAt = null;
        this.idleReaction(a, idleChoice(a.c, a.emotion, rng, !this.reducedMotion), { type: "idle_reaction", actor: a.id, kind: "look_around" });
      }
    }
    this.emit();
  }

  private step(a: Actor, dt: number) {
    const m = a.move;
    if (!m) {
      this.setState(a, "idle");
      return;
    }
    // Approaching someone who moved: re-aim.
    if (m.kind === "approach" && m.targetId) {
      const t = this.actors.get(m.targetId);
      if (!t) return this.arrive(a);
      // Close enough already (and not standing in anyone's space): stop here.
      if (standGap(a, t) <= m.distance + 2 && isFree(this.room, a, this.standBlockers(a), PERSONAL_SPACE)) return this.arrive(a);
      if (m.aimedAt && this.time - m.aimedMs > RETARGET_MS && Math.hypot(t.x - m.aimedAt.x, t.y - m.aimedAt.y) > 6) {
        m.aimedMs = this.time;
        m.aimedAt = { x: t.x, y: t.y };
        const goal = this.approachGoal(a, t, m.distance);
        const path = goal ? this.plan(a, goal) : null;
        if (goal && path) {
          m.goal = goal;
          m.path = path;
        }
      }
    }
    const next = m.path[0];
    if (!next) return this.arrive(a);
    const dx = next.x - a.x;
    const dy = next.y - a.y;
    const dist = Math.hypot(dx, dy);
    const stepLen = (m.speed * dt) / 1000;
    const p = dist <= stepLen ? { x: next.x, y: next.y } : { x: a.x + (dx / dist) * stepLen, y: a.y + (dy / dist) * stepLen };
    if (Math.abs(dx) > 0.5) a.facing = dx > 0 ? 1 : -1;
    // Collision: never into furniture, a wall, or someone else's footprint.
    const others = this.blockersFor(a, [], PASSING_SPACE - 2).filter((b) => gap(a, b) >= gap(p, b) - 0.01);
    if (!isFree(this.room, p, others)) {
      m.blockedMs += dt;
      if (m.blockedMs >= BLOCKED_REPLAN_MS) {
        m.blockedMs = 0;
        m.replans++;
        const path = m.replans <= MAX_REPLANS ? this.plan(a, m.goal) : null;
        if (path) m.path = path;
        else if (m.replans > MAX_REPLANS || m.kind !== "approach") return this.giveUp(a);
        else {
          const t = m.targetId ? this.actors.get(m.targetId) : null;
          const goal = t ? this.approachGoal(a, t, m.distance) : null;
          const p2 = goal ? this.plan(a, goal) : null;
          if (goal && p2) {
            m.goal = goal;
            m.path = p2;
          } else return this.giveUp(a);
        }
      }
      return;
    }
    m.blockedMs = 0;
    a.x = p.x;
    a.y = p.y;
    if (dist <= stepLen) m.path.shift();
    if (!m.path.length) this.arrive(a);
  }

  private arrive(a: Actor) {
    const m = a.move;
    a.move = null;
    if (m?.targetId) {
      const t = this.actors.get(m.targetId);
      if (t) this.faceToward(a, t);
    }
    const social = m?.kind === "approach" || (m?.kind === "makeRoom" && !!m.targetId);
    const obj = m?.kind === "object" && m.objectId ? this.objectById(m.objectId) : null;
    if (social || obj) a.interactUntil = this.time + INTERACT_MS;
    if (obj) {
      const cx = (obj.bounds.x0 + obj.bounds.x1) / 2;
      if (Math.abs(cx - a.x) >= 2) a.facing = cx > a.x ? 1 : -1;
      a.usingObject = obj.id;
      if (m!.action === "sit") a.pose = "sit";
    }
    this.setState(a, social || obj || this.convo.has(a.id) ? "interacting" : "idle");
    const priority = this.priorityName(a.movePriority);
    this.endCommand(a);
    if (m) this.onWalkEnd?.(a.id, "arrived", m.kind, priority);
    if (obj && m?.action) this.onObject?.(a.id, obj.id, m.action, priority);
    // Ended up in someone's personal space (they moved too)? Take one small step to make room.
    if (m && m.kind !== "makeRoom" && m.kind !== "object" && this.crowding(a)) this.makeRoom(a, m.targetId);
    if (m?.kind === "approach" && m.targetId && this.actors.has(m.targetId)) this.onArrive?.(a.id, m.targetId, priority);
  }

  private crowding(a: Actor): boolean {
    for (const b of this.actors.values()) if (b.id !== a.id && b.state !== "moving" && standGap(a, b) < PERSONAL_SPACE - 2) return true;
    return false;
  }

  private makeRoom(a: Actor, targetId: string | null) {
    const goal = nearestFree(this.room, { x: a.x, y: a.y }, this.standBlockers(a), PERSONAL_SPACE, 64);
    const path = goal ? this.plan(a, goal) : null;
    if (!goal || !path) return;
    this.beginMove(a, { kind: "makeRoom", targetId, distance: 0, goal, path, speed: walkSpeed(a.c, a.emotion) * 0.8, blockedMs: 0, replans: 0, aimedAt: null, aimedMs: this.time });
  }

  private giveUp(a: Actor) {
    const m = a.move;
    a.move = null;
    const priority = this.priorityName(a.movePriority);
    this.endCommand(a);
    if (m) this.onWalkEnd?.(a.id, "failed", m.kind, priority);
    this.setState(a, this.convo.has(a.id) ? "interacting" : "idle");
    if (m) {
      const action: StageAction =
        m.kind === "approach" && m.targetId
          ? { type: "approach", actor: a.id, target: m.targetId }
          : m.kind === "object" && m.objectId
            ? { type: "use_object", actor: a.id, object: m.objectId, action: m.action }
            : m.kind === "goto"
              ? { type: "walk_to", actor: a.id, x: m.goal.x, y: m.goal.y }
              : { type: "retreat", actor: a.id, from: m.targetId ?? undefined };
      this.lastResult.set(a.id, { ok: false, reason: "no_path", action });
    }
  }
}
