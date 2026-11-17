"use client";
/**
 * React wiring for character autonomy: runs the engine a few times a
 * second (cheap; the planner itself is rate-limited per character), feeds
 * it stage events, and keeps the agency state in the world save.
 *
 * Also the conversation hooks used by the walk-and-talk flow:
 *   endedConversation  the listener ended it → boundary, turn away, walk away
 *   refusesTalk        would the listener talk to this person right now?
 *   refused            they tried too soon → refused, push recorded, turn away
 *   heard              something a character said may be a plan ("I'm going to the window")
 *   conversationOver   carry out those plans, or say there's no such place
 */
import { useCallback, useEffect, useRef } from "react";
import { rngFrom } from "../stage/behavior";
import { recordInteraction } from "../relationships/progression";
import type { StageSim } from "../stage/sim";
import type { WorldObject } from "../stage/objects";
import type { Character, StoryState } from "../types";
import { makeId } from "../id";
import { recordBoundary, recordPush, resolveBoundary, severityFrom, willingToTalk } from "./convoBoundary";
import { submit, tick, walkEnded, type EngineEnv } from "./engine";
import { goalFromLine } from "./goals";
import { agencyOf, resumeAfterLoad } from "./lifecycle";
import { AUTONOMY, type AgencyState } from "./types";
import { newIntent } from "./validate";
import { witness } from "./environment";

export type AutonomyNotice = "walkedAway" | "refused" | "goingTo" | "noSuchPlace" | "inviteAccepted" | "inviteDeclined";

export type AutonomyDeps = {
  stage: StageSim;
  cast: Character[];
  objects: WorldObject[];
  /** "worldId:place", so saved spots only come back in the same room. */
  roomKey: string;
  getStory: () => StoryState;
  setStoryState: (s: StoryState) => void;
  /** Autonomous behavior on/off (paused game, modal open, setting off). Conversation hooks always work. */
  enabled: boolean;
  inConversation: (id: string) => boolean;
  /** Show a notice; `other` is a name already written out. */
  notify: (kind: AutonomyNotice, actorId: string, other: string) => void;
  objectName: (id: string) => string;
  nameOf: (id: string) => string;
};

export function useAutonomy(d: AutonomyDeps) {
  const deps = useRef(d);
  deps.current = d;
  const resumed = useRef(false);

  const env = useCallback((): EngineEnv => {
    const x = deps.current;
    return {
      stage: {
        request: (a, ctx, pr) => x.stage.request(a, ctx, pr),
        position: (id) => x.stage.position(id),
        poseOf: (id) => x.stage.poseOf(id),
        walkOf: (id) => x.stage.walkOf(id),
        isCommanded: (id) => x.stage.isCommanded(id),
      },
      cast: x.cast,
      objects: x.objects,
      story: x.getStory(),
      inConversation: x.inConversation,
      now: Date.now(),
      rng: (key) => rngFrom(key),
      // An invitation and its answer are worth a short notice (no AI; the answer is the invitee's own).
      onEvent: (e) => x.notify(e.answer.accept ? "inviteAccepted" : "inviteDeclined", e.actor, x.nameOf(e.target)),
    };
  }, []);

  const write = useCallback((fn: (a: AgencyState, s: StoryState) => AgencyState) => {
    const s = deps.current.getStory();
    const before = agencyOf(s.agency);
    const after = fn(before, s);
    if (after !== before) deps.current.setStoryState({ ...deps.current.getStory(), agency: after });
    return after;
  }, []);

  // After loading a save: walks that were under way are queued again.
  useEffect(() => {
    if (resumed.current || !d.cast.length) return;
    resumed.current = true;
    write((a) => (a.intents.length ? resumeAfterLoad(a) : a));
  }, [d.cast.length, write]);

  // Stage events: a walk ended.
  useEffect(() => {
    const { stage } = d;
    const prev = stage.onWalkEnd;
    stage.onWalkEnd = (actor, outcome, kind, priority) => {
      prev?.(actor, outcome, kind, priority);
      write((a) => {
        const was = a.intents.find((i) => i.actor === actor && i.status === "executing");
        let next = walkEnded(a, actor, outcome, Date.now());
        // Others close by saw what they went to enjoy: that's how characters learn each other's interests.
        if (was?.object && outcome === "arrived" && (was.kind === "inspect_object" || was.kind === "use_object" || was.kind === "sit" || was.kind === "return_to_task")) {
          const x = deps.current;
          next = witness(next, actor, was.object, x.objects, x.cast, (id) => x.stage.position(id));
        }
        // A plan someone said out loud ("I'm going to the window") is done when they get there.
        if (was?.kind === "go_to_place") {
          const status = outcome === "arrived" ? ("done" as const) : ("failed" as const);
          next = { ...next, goals: next.goals.map((g) => (g.actor === actor && g.status === "started" && g.object === was.object ? { ...g, status } : g)) };
        }
        return next;
      });
    };
    return () => {
      stage.onWalkEnd = prev;
    };
  }, [d.stage, write]);

  // The loop.
  const enabled = d.enabled;
  useEffect(() => {
    if (!enabled) return;
    let lastSpots = "";
    const id = window.setInterval(() => {
      if (deps.current.stage.paused) return;
      const e = env();
      write((a) => tick(a, e));
      // Where everyone stands, saved when it changes (a reload puts them back).
      const at = deps.current.stage.spots();
      const key = JSON.stringify(at);
      if (key !== lastSpots && Object.keys(at).length) {
        lastSpots = key;
        write((a) => ({ ...a, spots: { place: deps.current.roomKey, at } }));
      }
    }, AUTONOMY.tickMs);
    return () => window.clearInterval(id);
  }, [enabled, env, write]);

  /** The listener ended the conversation: boundary recorded, they turn away and walk off. */
  const endedConversation = useCallback(
    (listenerId: string, speakerId: string) => {
      const x = deps.current;
      write((a, s) => recordBoundary(a, listenerId, speakerId, severityFrom(s, listenerId), s.turn));
      // Walking off is the one intentional exception to standing still in a conversation.
      x.stage.leaveConversation(listenerId);
      x.stage.request({ type: "turn_away", actor: listenerId, from: speakerId }, "event", "story");
      window.setTimeout(() => {
        const y = deps.current;
        // Somewhere quiet if there is one far enough away, otherwise just away from them.
        const sp = y.stage.position(speakerId);
        const quiet = y.objects
          .filter((o) => o.private && !o.giftId && o.anchors.length)
          .map((o) => ({ o, d: sp ? Math.hypot(o.anchors[0].x - sp.x, o.anchors[0].y - sp.y) : 0 }))
          .filter((q) => q.d > 70)
          .sort((p, q) => q.d - p.d)[0]?.o;
        const intent = quiet
          ? newIntent({ actor: listenerId, kind: "seek_privacy", object: quiet.id, target: speakerId, reason: "endedConversation", source: "story" })
          : newIntent({ actor: listenerId, kind: "move_away", target: speakerId, reason: "endedConversation", source: "story" });
        let ok = false;
        write((a) => {
          const r = submit(a, intent, env());
          ok = r.intent.status === "executing" || r.intent.status === "completed";
          return r.agency;
        });
        if (ok) y.notify("walkedAway", speakerId, y.nameOf(listenerId));
      }, 700);
    },
    [env, write],
  );

  const refusesTalk = useCallback((listenerId: string, speakerId: string) => {
    const x = deps.current;
    const me = x.cast.find((c) => c.id === listenerId);
    const them = x.cast.find((c) => c.id === speakerId);
    if (!me || !them) return null;
    const check = willingToTalk(x.getStory(), x.getStory().agency, me, them);
    return check.willing ? null : check;
  }, []);

  /** Tried to talk too soon: refused (it can't be bypassed by retrying), and the push is remembered. */
  const refused = useCallback(
    (listenerId: string, speakerId: string) => {
      const x = deps.current;
      const me = x.cast.find((c) => c.id === listenerId);
      const them = x.cast.find((c) => c.id === speakerId);
      if (!me || !them) return;
      let s = recordInteraction(x.getStory(), { from: me, to: them, kind: "boundary_push", source: "behavior", why: "tried to talk again after the conversation was ended", topic: "conversation" }).story;
      s = { ...s, agency: recordPush(agencyOf(s.agency), listenerId, speakerId) };
      x.setStoryState(s);
      x.stage.request({ type: "turn_away", actor: listenerId, from: speakerId }, "event", "story");
      x.notify("refused", speakerId, x.nameOf(listenerId));
    },
    [],
  );

  /** They're talking again (willingly): the old boundary no longer applies. */
  const talking = useCallback(
    (a: string, b: string) => write((ag) => resolveBoundary(resolveBoundary(ag, a, b), b, a)),
    [write],
  );

  /** A line a character said: a genuine plan to go somewhere becomes a goal for after the conversation. */
  const heard = useCallback(
    (speakerId: string, text: string) => {
      const g = goalFromLine(text, deps.current.objects);
      if (!g) return;
      write((a) => ({
        ...a,
        goals: [...a.goals.filter((x) => !(x.actor === speakerId && x.status === "pending")), { id: makeId("goal"), actor: speakerId, place: g.place, object: g.object?.id ?? null, text: text.slice(0, 200), at: Date.now(), status: "pending" as const }].slice(-12),
      }));
    },
    [write],
  );

  /** The conversation is over: follow through on what was said. */
  const conversationOver = useCallback(
    (ids: string[]) => {
      window.setTimeout(() => {
        const x = deps.current;
        const pending = agencyOf(x.getStory().agency).goals.filter((g) => g.status === "pending" && ids.includes(g.actor));
        for (const g of pending) {
          if (!g.object || !x.objects.some((o) => o.id === g.object)) {
            write((a) => ({ ...a, goals: a.goals.map((y) => (y.id === g.id ? { ...y, status: "unavailable" as const } : y)) }));
            x.notify("noSuchPlace", g.actor, g.place);
            continue;
          }
          const res: { status: "started" | "failed" } = { status: "failed" };
          // They said they'd go: an intentional move, not a routine walk the conversation hold should stop.
          x.stage.leaveConversation(g.actor);
          write((a) => {
            const r = submit(a, newIntent({ actor: g.actor, kind: "go_to_place", object: g.object!, place: g.place, reason: "saidSo", source: "dialogue" }), env());
            res.status = r.intent.status === "failed" ? "failed" : "started";
            return { ...r.agency, goals: r.agency.goals.map((y) => (y.id === g.id ? { ...y, status: res.status } : y)) };
          });
          if (res.status === "started") x.notify("goingTo", g.actor, x.objectName(g.object));
        }
      }, 900);
    },
    [env, write],
  );

  return { endedConversation, refusesTalk, refused, talking, heard, conversationOver };
}

export type AutonomyController = ReturnType<typeof useAutonomy>;
