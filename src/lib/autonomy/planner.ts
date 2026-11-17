/**
 * AUTONOMY PLANNER — deterministic rules that let a character decide to do
 * something on their own. No AI, no per-frame work: run for one character
 * at a time, every few seconds (AUTONOMY.thinkMs), and it proposes at most
 * one intent (or nothing — standing still is a perfectly good choice).
 *
 * What a character does comes from what they FEEL right now, WHO they are
 * (personality factors from their sliders + written profile), their
 * relationships and boundaries, and what's in the room. Never from gender,
 * and the same feeling leads different people to different things:
 *
 *   upset      an avoidant / reserved person seeks a quiet spot; a
 *              confrontational one stands their ground; someone who trusts
 *              a friend may go to them instead
 *   sad        some want company (a trusted friend), some want quiet
 *   happy      an outgoing person seeks someone they like; a quieter one
 *              potters about with something in the room
 *   puzzled    curious people go and look at things; others just observe
 *   calm       mostly stay put; now and then return to what they were doing
 *              or look at something that suits them
 *
 * A boundary always wins: a character never walks up to someone they're
 * keeping away from (or who is keeping away from them), and moves away if
 * that person is close.
 */
import { level } from "../mind/feelings";
import { personalityOf } from "../mind/profile";
import { currentRelation } from "../relationships/progression";
import type { WorldObject } from "../stage/objects";
import type { Point } from "../stage/room";
import type { Character, StoryState } from "../types";
import { boundaryOf } from "./convoBoundary";
import type { AgencyState, IntentKind } from "./types";
import { envProposals, type ConceptId, type KnowledgeSource } from "./environment";

export type Proposal = {
  kind: IntentKind | "invite";
  target?: string;
  object?: string;
  reason: string;
  score: number;
  /** avoid_object: where to step to. */
  at?: Point;
  /** Came from the environment (environment.ts): cooldowns apply, and what it's about. */
  env?: { concept: ConceptId; knowledge?: KnowledgeSource };
};

export type PlanContext = {
  actor: Character;
  story: StoryState;
  /** Everyone on stage (including the actor). */
  cast: Character[];
  objects: WorldObject[];
  position: (id: string) => Point | null;
  pose: (id: string) => "sit" | null;
  agency: AgencyState;
  rng: () => number;
  /** Game time (ms). Without it, the environment isn't considered (older callers, tests of the base rules). */
  now?: number;
  /** In a conversation or walking somewhere: can't take up an invitation now. */
  busy?: (id: string) => boolean;
};

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const objCenter = (o: WorldObject): Point => o.anchors[0] ?? { x: (o.bounds.x0 + o.bounds.x1) / 2, y: o.bounds.y1 };

/** Is there a standing boundary between these two, in either direction? */
export function keepsApart(agency: AgencyState, a: string, b: string): boolean {
  return !!boundaryOf(agency, a, b) || !!boundaryOf(agency, b, a);
}

/** All proposals worth considering, best first (exported for the debug view and tests). */
export function proposals(ctx: PlanContext): Proposal[] {
  const { actor, story, cast, objects, agency, rng } = ctx;
  const me = ctx.position(actor.id);
  if (!me) return [];
  const p = personalityOf(actor);
  const f = story.characters[actor.id]?.feelings ?? {};
  const upset = Math.max(level(f, "anger"), level(f, "frustration"));
  const low = Math.max(level(f, "sadness"), level(f, "anxiety"));
  const bright = Math.max(level(f, "happiness"), level(f, "excitement"));
  const puzzled = Math.max(level(f, "surprise"), level(f, "confusion"));
  const embarrassed = level(f, "embarrassment");
  const others = cast.filter((c) => c.id !== actor.id && ctx.position(c.id));
  const gap = (id: string) => dist(me, ctx.position(id)!);
  const out: Proposal[] = [];
  const add = (x: Proposal) => out.push({ ...x, score: x.score + rng() * 0.12 });

  const privateSpots = objects.filter((o) => o.private && !o.giftId).sort((a, b) => dist(me, objCenter(b)) - dist(me, objCenter(a)));
  const farthestPrivate = (from: Point | null) => (from ? [...privateSpots].sort((a, b) => dist(from, objCenter(b)) - dist(from, objCenter(a)))[0] : privateSpots[0]);
  const liked = others
    .filter((o) => !keepsApart(agency, actor.id, o.id))
    .map((o) => ({ o, rel: currentRelation(story, actor, o) }))
    .sort((a, b) => b.rel.affection + b.rel.trust - (a.rel.affection + a.rel.trust));

  // 1. Boundaries first: someone they're keeping apart from is close → get some distance.
  for (const o of others) {
    if (!keepsApart(agency, actor.id, o.id) || gap(o.id) > 64) continue;
    const quiet = farthestPrivate(ctx.position(o.id));
    if (quiet && (p.reserved > 0.5 || p.avoidant > 0.5)) add({ kind: "seek_privacy", object: quiet.id, reason: "keepingDistance", score: 0.95 });
    else add({ kind: "move_away", target: o.id, reason: "keepingDistance", score: 0.9 });
  }

  // Exits and counters aren't things to idly look at: doors are for leaving, counters for asking.
  const lookable = objects.filter((o) => !o.exit && o.type !== "counter" && (!o.giftId || o.ownerId === actor.id));
  const exits = objects.filter((o) => o.exit && !o.giftId && o.anchors.length);
  const counter = objects.find((o) => o.type === "counter" && o.anchors.length);

  // 2. Upset.
  if (upset >= 50) {
    // Wants out: an avoidant person who's had enough heads for the door (they only go and stand by it; leaving the area is the player's call).
    const door = [...exits].sort((a, b) => dist(me, objCenter(a)) - dist(me, objCenter(b)))[0];
    if (door && upset >= 60 && p.avoidant > 0.55) add({ kind: "go_to_place", object: door.id, reason: "wantsToLeave", score: 0.42 + p.avoidant * 0.25 });
    if (p.confront > 0.6) add({ kind: "stay_still", reason: "standingGround", score: 0.5 + p.confront * 0.3 });
    const quiet = privateSpots[privateSpots.length - 1];
    if (quiet) add({ kind: "seek_privacy", object: quiet.id, reason: "coolingOff", score: 0.45 + (p.avoidant + p.reserved) * 0.2 });
    const friend = liked.find((x) => x.rel.trust >= 40);
    if (friend && p.dependent > 0.5) add({ kind: "approach", target: friend.o.id, reason: "seeksComfort", score: 0.4 + p.dependent * 0.3 });
  }

  // 3. Sad or anxious.
  if (low >= 45) {
    const friend = liked.find((x) => x.rel.trust >= 30 && x.rel.affection >= 30);
    if (friend) add({ kind: "approach", target: friend.o.id, reason: "seeksComfort", score: 0.35 + (p.trusting + p.expressive) * 0.2 });
    const seat = objects.find((o) => o.private && o.actions.includes("sit")) ?? objects.find((o) => o.actions.includes("sit"));
    if (seat && ctx.pose(actor.id) !== "sit") add({ kind: "sit", object: seat.id, reason: "needsQuiet", score: 0.35 + (p.intro + p.reserved) * 0.2 });
    else if (privateSpots.length) add({ kind: "seek_privacy", object: privateSpots[privateSpots.length - 1].id, reason: "needsQuiet", score: 0.3 + p.intro * 0.25 });
  }

  // 4. Embarrassed with someone close by → turn away (not a walk).
  if (embarrassed >= 40) {
    const near = others.filter((o) => gap(o.id) < 50).sort((a, b) => gap(a.id) - gap(b.id))[0];
    if (near) add({ kind: "turn_away", target: near.id, reason: "embarrassed", score: 0.45 + p.reserved * 0.2 });
  }

  // 5. Happy / excited.
  if (bright >= 50) {
    const pal = liked.find((x) => x.rel.affection >= 15 && gap(x.o.id) > 45);
    if (pal) add({ kind: "approach", target: pal.o.id, reason: "wantsCompany", score: 0.3 + p.extro * 0.35 + p.playful * 0.1 });
    const thing = pick(lookable, rng);
    if (thing) add({ kind: "inspect_object", object: thing.id, reason: "contentAlone", score: 0.25 + p.intro * 0.3 });
  }

  // 6. Surprised or confused.
  if (puzzled >= 40) {
    // Curious minds go for the mysterious things first: books, chests, signs.
    const mysterious = lookable.filter((o) => o.type === "book" || o.type === "chest" || o.type === "sign");
    const thing = [...(mysterious.length ? mysterious : lookable)].sort((a, b) => dist(me, objCenter(a)) - dist(me, objCenter(b)))[0];
    if (thing) add({ kind: "inspect_object", object: thing.id, reason: "curious", score: 0.3 + (p.impulsive + p.rebel) * 0.15 });
    // Someone with questions and a bartender to ask: go and ask (a local exchange, no AI).
    if (counter && p.extro > 0.45) add({ kind: "use_object", object: counter.id, reason: "asksAround", score: 0.28 + p.extro * 0.2 });
    add({ kind: "observe", reason: "takingItIn", score: 0.3 + p.cautious * 0.25 });
  }

  // 7. Calm: mostly nothing. Now and then something that fits them.
  if (upset < 30 && low < 30 && bright < 50 && puzzled < 40) {
    const last = [...agency.log].reverse().find((i) => i.actor === actor.id && i.status === "completed" && i.object && i.kind !== "seek_privacy");
    if (last?.object && objects.some((o) => o.id === last.object)) add({ kind: "return_to_task", object: last.object, reason: "backToIt", score: 0.2 + p.serious * 0.15 });
    const thing = pick(lookable, rng);
    if (thing) add({ kind: "inspect_object", object: thing.id, reason: "idleCuriosity", score: 0.12 + (p.playful + p.impulsive + p.idealist) * 0.08 });
    if (ctx.pose(actor.id) === "sit") add({ kind: "stand", reason: "stretchLegs", score: 0.18 + p.impulsive * 0.15 });
    add({ kind: "stay_still", reason: "content", score: 0.3 + (p.calm + p.cautious) * 0.1 });
  }

  // 8. The room itself: things they love, fear or that touch a memory; inviting someone over (environment.ts).
  if (ctx.now !== undefined)
    for (const e of envProposals({ actor, story, cast, objects, position: ctx.position, agency, now: ctx.now, apart: (x, y) => keepsApart(agency, x, y), busy: ctx.busy ?? (() => false), rng })) {
      out.push({ kind: e.kind, object: e.object, target: e.target, at: e.at, reason: e.reason, score: e.score, env: { concept: e.concept, knowledge: e.knowledge } });
    }

  // Don't repeat yourself: the same thing as one of the last two times scores much lower.
  const recent = agency.log.filter((i) => i.actor === actor.id).slice(-2);
  for (const x of out) if (recent.some((r) => r.kind === x.kind && (r.object ?? r.target) === (x.object ?? x.target))) x.score *= 0.45;
  return out.sort((a, b) => b.score - a.score);
}

function pick<T>(list: T[], rng: () => number): T | undefined {
  return list.length ? list[Math.floor(rng() * list.length) % list.length] : undefined;
}

/**
 * The one thing to do now, or null. Even the best proposal only goes ahead
 * if it beats a bar that depends on temperament (impulsive people act on
 * small urges; cautious ones need a stronger reason).
 */
export function planFor(ctx: PlanContext): Proposal | null {
  const best = proposals(ctx)[0];
  if (!best || best.kind === "stay_still") return null;
  const p = personalityOf(ctx.actor);
  const bar = 0.32 + p.cautious * 0.1 - p.impulsive * 0.1;
  return best.score >= bar ? best : null;
}
