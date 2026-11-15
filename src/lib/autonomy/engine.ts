/**
 * AUTONOMY ENGINE — plain functions (no React) that move intents through
 * their lifecycle against the stage:
 *
 *   submit()     proposed → validated → queued → executing (→ completed at
 *                once for intents that aren't walks), or failed with a reason
 *   walkEnded()  the stage says a walk ended: executing → completed /
 *                failed (blocked) / interrupted (replaced, e.g. by the player)
 *   tick()       housekeeping (time-outs, expired queue), queued intents get
 *                another try, and characters whose turn it is to think run
 *                the planner (rate-limited per character and overall)
 *
 * The React side (useAutonomy.ts) only wires these to the stage and the save.
 */
import { personalityOf } from "../mind/profile";
import type { ActionResult, Priority, StageAction } from "../stage/actions";
import { travels } from "../stage/actions";
import type { WorldObject } from "../stage/objects";
import type { Point } from "../stage/room";
import type { Character, StoryState } from "../types";
import { activeOf, advance, isActive, putIntent } from "./lifecycle";
import { planFor } from "./planner";
import { AUTONOMY, type AgencyState, type Intent } from "./types";
import { newIntent, toStageAction, validateIntent, WALKING_KINDS, type ValidateContext } from "./validate";

/** The slice of StageSim the engine uses (tests pass a fake). */
export type StagePort = {
  request: (raw: StageAction, context: "event", priority: Priority) => ActionResult;
  position: (id: string) => Point | null;
  poseOf: (id: string) => "sit" | null;
  walkOf: (id: string) => { priority: Priority } | null;
  isCommanded: (id: string) => boolean;
};

export type EngineEnv = {
  stage: StagePort;
  cast: Character[];
  objects: WorldObject[];
  story: StoryState;
  inConversation: (id: string) => boolean;
  now: number;
  rng: (key: string) => () => number;
};

const validateCtx = (a: AgencyState, env: EngineEnv): ValidateContext => ({
  onStage: (id) => !!env.stage.position(id),
  objects: env.objects,
  inConversation: env.inConversation,
  commanded: env.stage.isCommanded,
  walking: (id) => env.stage.walkOf(id)?.priority ?? null,
  agency: a,
  autonomousWalks: a.intents.filter((i) => i.status === "executing" && i.priority === "auto" && WALKING_KINDS.includes(i.kind)).length,
});

/** Try to run a queued intent now. */
function execute(a: AgencyState, i: Intent, env: EngineEnv): AgencyState {
  const v = validateIntent(i, validateCtx({ ...a, intents: a.intents.filter((x) => x.id !== i.id) }, env));
  if (!v.ok) return putIntent(a, advance(i, "failed", v.note, env.now));
  const action = toStageAction(i, env.objects);
  if (!action) return putIntent(a, advance(advance(i, "executing", undefined, env.now), "completed", undefined, env.now));
  const res = env.stage.request(action, "event", i.priority);
  if (!res.ok) return putIntent(a, advance(i, "failed", res.reason, env.now));
  const running = advance(i, "executing", res.note, env.now);
  // Not a walk, or a walk that finished on the spot (already there): done.
  if (!travels(res.action) || !env.stage.walkOf(i.actor)) return putIntent(a, advance(running, "completed", res.note, env.now));
  return putIntent(a, running);
}

/** Propose an intent: validate it, queue it, and run it if it can run now. */
export function submit(a: AgencyState, i: Intent, env: EngineEnv): { agency: AgencyState; intent: Intent } {
  const v = validateIntent(i, validateCtx(a, env));
  if (!v.ok) {
    const failed = advance(i, "failed", v.note, env.now);
    return { agency: putIntent(a, failed), intent: failed };
  }
  // A newer intent from the story or dialogue replaces an older autonomous one for the same character.
  let next = a;
  for (const old of activeOf(a, i.actor)) if (old.priority === "auto" || i.priority === "story") next = putIntent(next, advance(old, "interrupted", "replaced", env.now));
  const queued = advance(advance(i, "validated", undefined, env.now), "queued", undefined, env.now);
  next = execute(putIntent(next, queued), queued, env);
  const out = next.intents.find((x) => x.id === i.id) ?? next.log.find((x) => x.id === i.id) ?? queued;
  return { agency: { ...next, lastActed: { ...(next.lastActed ?? {}), [i.actor]: env.now } }, intent: out };
}

/** The stage reports that `actor`'s walk ended. */
export function walkEnded(a: AgencyState, actor: string, outcome: "arrived" | "failed" | "cancelled", now: number): AgencyState {
  const i = a.intents.find((x) => x.actor === actor && x.status === "executing");
  if (!i) return a;
  const to = outcome === "arrived" ? "completed" : outcome === "failed" ? "failed" : "interrupted";
  return putIntent(a, advance(i, to, outcome === "failed" ? "no_path" : outcome === "cancelled" ? "replaced" : undefined, now));
}

/** One autonomy step. Returns the same object when nothing changed. */
export function tick(a0: AgencyState, env: EngineEnv): AgencyState {
  let a = a0;
  const { now } = env;
  // Housekeeping: a walk that never ended, or a queued intent that never got to run.
  for (const i of a.intents) {
    if (i.status === "executing" && now - i.updatedAt > AUTONOMY.executeTimeoutMs) a = putIntent(a, advance(i, "failed", "timeout", now));
    else if (i.status === "executing" && WALKING_KINDS.includes(i.kind) && !env.stage.walkOf(i.actor)) a = putIntent(a, advance(i, "completed", undefined, now));
    else if (i.status === "queued" && now - i.createdAt > AUTONOMY.queueTtlMs) a = putIntent(a, advance(i, "failed", "expired", now));
  }
  // Queued intents (e.g. "go to the window" after a conversation) get another try.
  for (const i of a.intents.filter((x) => x.status === "queued")) {
    if (env.inConversation(i.actor) || env.stage.walkOf(i.actor)) continue;
    a = execute(a, i, env);
  }
  // Planning: one character at a time thinks, when it's their turn.
  for (const actor of env.cast) {
    if (!env.stage.position(actor.id) || env.inConversation(actor.id) || env.stage.walkOf(actor.id) || env.stage.isCommanded(actor.id)) continue;
    if (a.intents.some((i) => i.actor === actor.id && isActive(i))) continue;
    const p = personalityOf(actor);
    // Impulsive people think (and act) a bit more often, cautious ones less.
    const pace = 1 + 0.4 * p.cautious - 0.4 * p.impulsive;
    const thought = a.lastThought?.[actor.id] ?? 0;
    const acted = a.lastActed?.[actor.id] ?? 0;
    if (now - thought < AUTONOMY.thinkMs * pace || now - acted < AUTONOMY.actGapMs * pace) continue;
    a = { ...a, lastThought: { ...(a.lastThought ?? {}), [actor.id]: now } };
    const plan = planFor({
      actor,
      story: env.story,
      cast: env.cast,
      objects: env.objects,
      position: env.stage.position,
      pose: env.stage.poseOf,
      agency: a,
      rng: env.rng(`${actor.id}:${Math.floor(now / AUTONOMY.thinkMs)}`),
    });
    if (plan) a = submit(a, newIntent({ actor: actor.id, kind: plan.kind, target: plan.target, object: plan.object, reason: plan.reason, source: "rules" }, now), env).agency;
    break; // at most one character thinks per tick
  }
  return a;
}
