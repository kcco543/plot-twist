"use client";

/**
 * The play screen's walk-and-talk controller. Connects the conversation flow
 * (flow.ts) to the systems that already exist:
 *
 *  - movement: the stage simulation's validated "approach" action (same
 *    pathfinding + collision as everything else), at player priority;
 *  - facing / staying together: face_target + beginConversation();
 *  - lines: the play screen's single dialogue queue, so speech bubbles, the
 *    dialogue panel and the story log all show the conversation;
 *  - the listener's answer: the behavior engine (decide + apply), with the
 *    topic's trigger;
 *  - state: story state (relations, memories, events) via the same setter
 *    every other system uses.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Character, EnvironmentTypeId, StoryLine, StoryState, WorldId } from "../types";
import type { StageSim } from "../stage/sim";
import type { BehaviorEvent, Decision } from "../mind";
import { decisionLines, relationOf } from "../mind";
import { emotionOf } from "../emotion/emotions";
import { bondBetween, rngFrom, talkDistance } from "../stage/behavior";
import { CHOOSING_PHASES, goTo, newSession, TALKING_PHASES, type TalkNotice, type TalkNoticeKind, type TalkSession } from "./flow";
import { applyCustom, applyTopic, sayKey, suggestTopics, talkContext, toneOf, type TopicChoice } from "./topics";
import { personalityOf } from "../mind/profile";
import { cleanMessage, requestCustomReply } from "./customReply";

/** A walk that takes longer than this is given up (target kept running off, etc.). */
export const WALK_TIMEOUT_MS = 20000;
/** Pause between arriving / facing and the options appearing. */
const FACE_MS = 450;

export type TalkDeps = {
  stage: StageSim;
  cast: Character[];
  world: WorldId;
  place: EnvironmentTypeId;
  locale: string;
  getStory: () => StoryState;
  setStoryState: (s: StoryState) => void;
  /** Behavior engine, split: decide without applying, then apply (movement, feelings, relations). */
  decideOnly: (event: BehaviorEvent) => Decision | null;
  commit: (d: Decision) => void;
  showLines: (lines: StoryLine[]) => void;
  /** Dialogue queue position, so the flow knows when a line has been read. */
  beatNo: number;
  lineIndex: number;
  lineInProgress: boolean;
  /** Recent lines (for the future AI reply). */
  recentText: () => string[];
  onSelect: (id: string) => void;
  /** The conversation ended (or was cancelled) while its lines may still be playing. */
  onEnd?: () => void;
};

export type TalkController = ReturnType<typeof useTalk>;

export function useTalk(d: TalkDeps) {
  const [session, setSessionState] = useState<TalkSession | null>(null);
  const [notice, setNotice] = useState<TalkNotice | null>(null);
  const ref = useRef<TalkSession | null>(null);
  const deps = useRef(d);
  deps.current = d;
  const nextId = useRef(1);
  const walk = useRef<{ started: number; dist: number }>({ started: 0, dist: 30 });
  const convo = useRef<{ beat: number; decision: Decision | null; custom: string | null }>({ beat: -1, decision: null, custom: null });

  const set = useCallback((s: TalkSession | null) => {
    ref.current = s;
    setSessionState(s);
  }, []);
  const nameOf = (id: string | null) => {
    const c = id ? deps.current.cast.find((x) => x.id === id) : null;
    return c ? c.name.trim() : "";
  };
  const tell = useCallback((kind: TalkNoticeKind, actor: string | null, target: string | null) => {
    setNotice({ kind, actor: nameOf(actor), target: nameOf(target), at: Date.now() });
  }, []);

  /** Leave the conversation (or the walk / the target choice). */
  const end = useCallback(
    (kind: TalkNoticeKind | null = null) => {
      const s = ref.current;
      if (!s) return;
      const { stage } = deps.current;
      if (s.phase === "MOVE_TO_TARGET") stage.cancelWalk(s.actorId);
      if (TALKING_PHASES.includes(s.phase)) {
        stage.endConversation();
        deps.current.onEnd?.();
      }
      convo.current = { beat: -1, decision: null, custom: null };
      set(null);
      if (kind) tell(kind, s.actorId, s.targetId);
    },
    [set, tell],
  );

  /** Tap-to-target: choose who `actorId` should talk to (tap them on stage or in the list). */
  const beginSelect = useCallback(
    (actorId: string) => {
      if (ref.current) end();
      setNotice(null);
      set(newSession(nextId.current++, actorId, "tap"));
    },
    [end, set],
  );

  /** Walk `actorId` over to `targetId` and open a conversation when they get there. */
  const startWalk = useCallback(
    (actorId: string, targetId: string, via: TalkSession["via"]): boolean => {
      const { stage, getStory, cast } = deps.current;
      if (actorId === targetId) return false;
      const me = cast.find((c) => c.id === actorId);
      const them = cast.find((c) => c.id === targetId);
      if (!me || !them || !stage.position(actorId) || !stage.position(targetId)) return false;
      // One conversation at a time: starting a new one ends the old one.
      if (ref.current) end();
      setNotice(null);
      const story = getStory();
      const dist = Math.max(22, talkDistance(me, bondBetween(story, actorId, targetId), emotionOf(story.characters[actorId]).emotion));
      if (stage.stateOf(actorId) === "speaking") {
        tell("busy", actorId, targetId);
        return false;
      }
      // Check the route BEFORE moving anyone: no route = feedback, never a forced walk.
      if (stage.previewApproach(actorId, targetId, dist) === null) {
        tell(stage.previewApproach(actorId, targetId, dist, { ignorePeople: true }) ? "blocked" : "unreachable", actorId, targetId);
        return false;
      }
      const res = stage.request({ type: "approach", actor: actorId, target: targetId, distance: dist }, "conversation", "player");
      if (!res.ok) {
        tell(res.reason === "no_room" ? "noRoom" : res.reason === "busy" || res.reason === "outranked" ? "busy" : "unreachable", actorId, targetId);
        return false;
      }
      walk.current = { started: performance.now(), dist };
      deps.current.onSelect(actorId);
      const s0 = newSession(nextId.current++, actorId, via);
      set(goTo(s0, "MOVE_TO_TARGET", { targetId }));
      return true;
    },
    [end, set, tell],
  );

  // ---- MOVE_TO_TARGET: watch the walk (re-aims happen inside the sim when the target moves).
  const phase = session?.phase ?? null;
  useEffect(() => {
    if (phase !== "MOVE_TO_TARGET") return;
    const { stage } = deps.current;
    const check = () => {
      const s = ref.current;
      if (!s || s.phase !== "MOVE_TO_TARGET" || !s.targetId) return;
      if (!stage.position(s.targetId)) return end("targetLeft");
      if (!stage.position(s.actorId)) return end("cancelled");
      const w = stage.walkOf(s.actorId);
      if (w) {
        if (w.targetId !== s.targetId) return end("cancelled");
        if (performance.now() - walk.current.started > WALK_TIMEOUT_MS) return end("tooLong");
        return;
      }
      const gap = stage.gapBetween(s.actorId, s.targetId) ?? Infinity;
      if (gap <= walk.current.dist + 10) set(goTo(s, "FACE_TARGET"));
      else end("lostTarget");
    };
    check();
    const unsubscribe = stage.subscribe(check);
    return () => {
      unsubscribe();
    };
  }, [phase, end, set]);

  const freshTopics = useCallback((s: TalkSession): TopicChoice[] => {
    const { cast, getStory, world, place } = deps.current;
    const me = cast.find((c) => c.id === s.actorId);
    const them = cast.find((c) => c.id === s.targetId);
    if (!me || !them) return [];
    const story = getStory();
    const rng = rngFrom(`${story.turn}:${me.id}:${them.id}:${s.round}:${Date.now()}`);
    return suggestTopics(talkContext(story, me, them, world, place), rng, s.offered);
  }, []);

  // ---- FACE_TARGET: both turn to each other and stay together, then the options open.
  useEffect(() => {
    if (phase !== "FACE_TARGET") return;
    const s = ref.current!;
    const { stage } = deps.current;
    stage.request({ type: "face_target", actor: s.actorId, target: s.targetId! }, "conversation", "story");
    stage.request({ type: "face_target", actor: s.targetId!, target: s.actorId }, "conversation", "story");
    stage.beginConversation([s.actorId, s.targetId!]);
    const timer = window.setTimeout(() => {
      const cur = ref.current;
      if (!cur || cur.id !== s.id || cur.phase !== "FACE_TARGET") return;
      const topics = freshTopics(cur);
      set(goTo(cur, "SHOW_OPTIONS", { topics, offered: [...cur.offered, ...topics.map((t) => t.id)] }));
    }, FACE_MS);
    return () => window.clearTimeout(timer);
  }, [phase, freshTopics, set]);

  /** Say one of the suggested topics. */
  const chooseTopic = useCallback(
    (choice: TopicChoice) => {
      const s = ref.current;
      const { cast, getStory, setStoryState, showLines, decideOnly, beatNo, lineInProgress, stage } = deps.current;
      if (!s || !CHOOSING_PHASES.includes(s.phase) || lineInProgress || !s.targetId) return;
      const me = cast.find((c) => c.id === s.actorId);
      const them = cast.find((c) => c.id === s.targetId);
      if (!me || !them) return end("targetLeft");
      const story = getStory();
      const variant = story.turn + s.round;
      setStoryState(applyTopic(story, me, them, choice, variant));
      stage.beginConversation([me.id, them.id]);
      // The listener's answer is decided now (from the updated state) but only plays out when their line comes up.
      const decision = decideOnly({ trigger: choice.trigger, reactorId: them.id, otherId: me.id });
      const said: StoryLine = {
        speaker: { kind: "character", name: me.name.trim(), id: me.id },
        key: "tpl",
        tpl: sayKey(choice, toneOf(personalityOf(me)), deps.current.world, deps.current.place),
        index: variant,
        params: { ...choice.vars, other: them.name.trim(), name: me.name.trim() },
        source: "builtin",
      };
      let reply = decision ? decisionLines(decision, cast, variant) : [];
      if (!reply.length) reply = [{ speaker: { kind: "narrator" }, key: "tpl", tpl: "talk.listens", index: variant, params: { other: them.name.trim() }, source: "builtin" }];
      convo.current = { beat: beatNo + 1, decision, custom: null };
      showLines([said, ...reply]);
      set(goTo(s, "SPEAK", { round: s.round + 1, composing: false }));
    },
    [end, set],
  );

  /** "Ask something else": open / close the composer. The draft is kept until it is sent. */
  const openComposer = useCallback(() => {
    const s = ref.current;
    if (s && CHOOSING_PHASES.includes(s.phase)) set({ ...s, composing: true });
  }, [set]);
  const closeComposer = useCallback(() => {
    const s = ref.current;
    if (s) set({ ...s, composing: false });
  }, [set]);
  const setDraft = useCallback(
    (draft: string) => {
      const s = ref.current;
      if (s) set({ ...s, draft });
    },
    [set],
  );

  /** Send the typed message: the speaker says it in their bubble. There is no AI reply yet (and we say so). */
  const sendCustom = useCallback(() => {
    const s = ref.current;
    const { cast, getStory, setStoryState, showLines, beatNo, lineInProgress, stage } = deps.current;
    if (!s || !CHOOSING_PHASES.includes(s.phase) || lineInProgress || !s.targetId) return false;
    const text = cleanMessage(s.draft);
    if (!text) return false;
    const me = cast.find((c) => c.id === s.actorId);
    const them = cast.find((c) => c.id === s.targetId);
    if (!me || !them) return false;
    setStoryState(applyCustom(getStory(), me, them));
    stage.beginConversation([me.id, them.id]);
    convo.current = { beat: beatNo + 1, decision: null, custom: text };
    showLines([{ speaker: { kind: "character", name: me.name.trim(), id: me.id }, key: "custom", params: { text } }]);
    set(goTo(s, "SPEAK", { round: s.round + 1, composing: false, draft: "", customPending: false }));
    return true;
  }, [set]);

  // ---- SPEAK → WAIT_FOR_RESPONSE → CONTINUE_OR_EXIT, following the dialogue queue.
  const { beatNo, lineIndex, lineInProgress } = d;
  useEffect(() => {
    const s = ref.current;
    if (!s || (s.phase !== "SPEAK" && s.phase !== "WAIT_FOR_RESPONSE")) return;
    const c = convo.current;
    // Our lines are on screen (ours), or something newer replaced them (moved on).
    const ours = beatNo === c.beat;
    const movedOn = beatNo > c.beat;
    if (s.phase === "SPEAK") {
      // Built-in topic: the reply starts when the player moves on to the listener's line.
      if (!c.custom && ((ours && lineIndex >= 1) || movedOn)) {
        if (c.decision) deps.current.commit(c.decision);
        set(goTo(s, "WAIT_FOR_RESPONSE"));
      }
      // Typed message: once it has been said, ask the reply service (not built yet).
      if (c.custom && ((ours && !lineInProgress) || movedOn)) {
        set(goTo(s, "WAIT_FOR_RESPONSE"));
        const { cast, getStory, world, place, locale, recentText, stage } = deps.current;
        const me = cast.find((x) => x.id === s.actorId)!;
        const them = cast.find((x) => x.id === s.targetId)!;
        const story = getStory();
        stage.request({ type: "face_target", actor: them.id, target: me.id }, "conversation", "story");
        void requestCustomReply({
          locale,
          world,
          place,
          speaker: { id: me.id, name: me.name.trim() },
          listener: { id: them.id, name: them.name.trim() },
          message: c.custom,
          relation: relationOf(story, them, me),
          listenerEmotion: emotionOf(story.characters[them.id]).emotion,
          recentLines: recentText(),
        }).then((r) => {
          const cur = ref.current;
          if (!cur || cur.id !== s.id || cur.phase !== "WAIT_FOR_RESPONSE") return;
          // r.status is always "unavailable" for now; an "ok" result will add the reply lines here.
          const next = { ...cur, customPending: r.status !== "ok" };
          const topics = freshTopics(next);
          set(goTo(next, "CONTINUE_OR_EXIT", { topics, offered: [...next.offered, ...topics.map((t) => t.id)] }));
        });
      }
      return;
    }
    if (!c.custom && ((ours && !lineInProgress) || movedOn)) {
      const topics = freshTopics(s);
      set(goTo(s, "CONTINUE_OR_EXIT", { topics, offered: [...s.offered, ...topics.map((t) => t.id)], customPending: false }));
    }
  }, [session, beatNo, lineIndex, lineInProgress, set, freshTopics]);

  // ---- Someone left the stage mid-conversation.
  const castKey = d.cast.map((c) => c.id).join("|");
  useEffect(() => {
    const s = ref.current;
    if (!s) return;
    const ids = castKey.split("|");
    if (!ids.includes(s.actorId) || (s.targetId && !ids.includes(s.targetId))) end("targetLeft");
  }, [castKey, end]);

  return {
    session,
    notice,
    dismissNotice: useCallback(() => setNotice(null), []),
    tell,
    beginSelect,
    startWalk,
    /** Cancel the target choice or the walk, or end the conversation. */
    cancel: useCallback(() => end(ref.current && TALKING_PHASES.includes(ref.current.phase) ? "ended" : "cancelled"), [end]),
    endConversation: useCallback(() => end("ended"), [end]),
    chooseTopic,
    openComposer,
    closeComposer,
    setDraft,
    sendCustom,
    /** Is this pair in a walk-and-talk right now (the autonomous "approached" reaction stays out of it)? */
    involves: useCallback((a: string, b: string) => {
      const s = ref.current;
      return !!s && s.phase !== "SELECT_TARGET" && ((s.actorId === a && s.targetId === b) || (s.actorId === b && s.targetId === a));
    }, []),
    active: useCallback(() => !!ref.current, []),
  };
}
