/**
 * GAME-ENGINE VALIDATION of AI replies — the AI proposes, the game decides.
 * --------------------------------------------------------------------------
 * validateReply() turns a reply from /api/ai/talk into changes the game is
 * willing to make, using the player's character definitions as the source
 * of truth:
 *
 *   emotion        only the allowed emotions; strength from intensity, capped
 *                  for reserved characters; canon masks ("never admits her
 *                  feelings") hide what the character wouldn't show; an angry
 *                  character doesn't flip to beaming in one line.
 *   movement       only none / approach / retreat / face_target / idle_reaction;
 *                  canon bans ("never backs down") and contradictions (stepping
 *                  away while warming up, walking up to someone feared) are
 *                  turned into a simple face_target. Walls and other people are
 *                  handled when the stage executes it (pathfinding + collision).
 *   relationship   trust / affection / respect / tension only, each clamped to
 *                  ±AI_STEP per exchange, total change capped, and strong
 *                  feelings barely move against their direction without a
 *                  major (importance 3) moment.
 *   memory         saved only when it matters; merged with a near-identical
 *                  memory instead of duplicated; an earlier open thread it
 *                  settles is marked resolved.
 *
 * applyReply() then writes the result to story state through the same
 * helpers every other system uses. Nothing is applied for a reply that
 * failed (there is nothing to apply).
 */
import { emotionOf, withEmotion, type Emotion, type EmotionLevel } from "../../emotion/emotions";
import { remember } from "../../mind/memory";
import { canonLimits, personalityOf } from "../../mind/profile";
import { applyRelation, relationOf, relKey, withRelation, type RelationDelta } from "../../mind/relations";
import { bondKey, neutralState } from "../../story/engine";
import { similarity } from "../../story/similarity";
import type { Character, Memory, MemoryKind, MemoryThread, Relation, StoryState, TalkLine } from "../../types";
import { outOfCharacter } from "./checks";
import { AI_RELATION_KEYS, type AiRelationKey, type MovementIntent, type TalkReply, type TalkSuggestion } from "./contract";

/** Largest change to one relationship number from one exchange. */
export const AI_STEP = 5;
/** Largest total change (sum of absolute values) from one exchange. */
export const AI_TOTAL = 10;
/** Above this (or below minus this), feelings barely move against their direction. */
export const STRONG_FEELING = 40;
/** …by at most this much, unless the moment is unforgettable. */
export const REVERSAL_STEP = 2;
/** Conversation lines kept per pair (older ones live on as memories). */
export const TALK_HISTORY_KEEP = 16;
export const RELATION_LOG_KEEP = 6;

export type ValidatedReply = {
  dialogue: string;
  emotion: Emotion;
  /** 0 when neutral. */
  level: 0 | EmotionLevel;
  movement: MovementIntent;
  relation: Partial<Record<AiRelationKey, number>>;
  memory: { kind: MemoryKind | null; importance: number; note: string; thread: MemoryThread | null } | null;
  /** Id of the listener's earlier open-thread memory this exchange settles. */
  resolves: string | null;
  suggestions: TalkSuggestion[];
  /** What the engine changed or refused, for the debug view and tests. */
  adjustments: string[];
};

const WARM: Emotion[] = ["happy", "excited", "affectionate"];
const HOT: Emotion[] = ["angry", "frustrated"];
const THREAD_KIND: Record<MemoryThread, MemoryKind> = { conflict: "argument", promise: "promise", secret: "secret", discovery: "cooperated" };

export type ValidateContext = {
  listener: Character;
  speaker: Character;
  story: StoryState;
};

export function validateReply(reply: TalkReply, ctx: ValidateContext): ValidatedReply {
  const { listener, speaker, story } = ctx;
  const adjustments: string[] = [];
  const p = personalityOf(listener);
  const canon = canonLimits(listener);
  const rel = relationOf(story, listener, speaker);
  const before = emotionOf(story.characters[listener.id]);

  // ---- emotion
  let emotion: Emotion = reply.emotion;
  const intensity = Number.isFinite(reply.reactionIntensity) ? Math.max(0, Math.min(1, reply.reactionIntensity)) : 0.4;
  let level: 0 | EmotionLevel = emotion === "neutral" ? 0 : intensity < 0.34 ? 1 : intensity < 0.67 ? 2 : 3;
  if (level === 3 && (p.reserved >= 0.6 || p.hides > 0)) {
    level = 2;
    adjustments.push("emotion:reserved_cap");
  }
  const masks: [string, Emotion, Emotion][] = [
    ["affection", "affectionate", "embarrassed"],
    ["fear", "anxious", "neutral"],
    ["sadness", "sad", "neutral"],
  ];
  for (const [feeling, shown, instead] of masks) {
    if (emotion === shown && canon.masked.has(feeling)) {
      emotion = instead;
      level = instead === "neutral" ? 0 : 1;
      adjustments.push(`emotion:canon_mask_${feeling}`);
    }
  }
  if (HOT.includes(before.emotion) && before.level >= 2 && WARM.includes(emotion) && level > 1) {
    level = 1;
    adjustments.push("emotion:cooling_down");
  }

  // ---- memory (decided before relationships: an unforgettable moment may move feelings further)
  const imp = Math.max(0, Math.min(3, Math.round(reply.memory.importance)));
  const note = reply.memory.summary.trim();
  const thread = reply.memory.thread === "none" ? null : reply.memory.thread;
  const kind: MemoryKind | null = reply.memory.kind !== "none" ? reply.memory.kind : thread ? THREAD_KIND[thread] : null;
  const significant = imp >= 1 && note.length > 0 && (kind !== null || imp >= 2);
  const memory = significant ? { kind, importance: imp, note, thread } : null;
  if (!significant && note) adjustments.push("memory:not_significant");
  const major = imp >= 3;

  // ---- relationship
  const relation: Partial<Record<AiRelationKey, number>> = {};
  let total = 0;
  for (const k of AI_RELATION_KEYS) {
    let d = Math.round(Number.isFinite(reply.relationshipChanges[k]) ? reply.relationshipChanges[k] : 0);
    if (Math.abs(d) > AI_STEP) {
      d = Math.sign(d) * AI_STEP;
      adjustments.push(`relation:${k}_step_cap`);
    }
    if (!major && k !== "tension") {
      if (rel[k] >= STRONG_FEELING && d < -REVERSAL_STEP) {
        d = -REVERSAL_STEP;
        adjustments.push(`relation:${k}_reversal_guard`);
      } else if (rel[k] <= -STRONG_FEELING && d > REVERSAL_STEP) {
        d = REVERSAL_STEP;
        adjustments.push(`relation:${k}_reversal_guard`);
      }
    }
    if (!major && k === "tension" && rel.tension >= 60 && d < -REVERSAL_STEP) {
      d = -REVERSAL_STEP;
      adjustments.push("relation:tension_reversal_guard");
    }
    if (d) relation[k] = d;
    total += Math.abs(d);
  }
  if (total > AI_TOTAL) {
    const f = AI_TOTAL / total;
    for (const k of AI_RELATION_KEYS) if (relation[k]) relation[k] = Math.sign(relation[k]!) * Math.max(1, Math.floor(Math.abs(relation[k]!) * f));
    adjustments.push("relation:total_cap");
  }

  // ---- movement
  let movement: MovementIntent = reply.movementIntent;
  if (movement === "retreat" && canon.banned.has("retreat")) {
    movement = "face_target";
    adjustments.push("movement:canon_no_retreat");
  }
  const warming = (relation.affection ?? 0) + (relation.trust ?? 0) >= 3 && WARM.includes(emotion);
  if (movement === "retreat" && warming) {
    movement = "face_target";
    adjustments.push("movement:contradiction_retreat_while_warming");
  }
  if (movement === "approach" && rel.fear >= 50 && !WARM.includes(emotion) && emotion !== "angry") {
    movement = "face_target";
    adjustments.push("movement:afraid_to_approach");
  }
  if (movement === "approach" && (relation.tension ?? 0) >= 3 && emotion !== "angry") {
    movement = "face_target";
    adjustments.push("movement:contradiction_approach_while_tense");
  }

  // ---- open thread this settles
  let resolves: string | null = null;
  const settle = reply.memory.resolves.trim();
  if (settle) {
    const open = (story.characters[listener.id]?.memories ?? []).filter((m) => m.withId === speaker.id && m.thread && !m.resolved && m.note);
    const best = open.map((m) => ({ m, s: similarity(m.note!, settle) })).sort((a, b) => b.s - a.s)[0];
    if (best && best.s >= 0.45) resolves = best.m.id;
  }

  const suggestions = reply.conversationSuggestions.filter((s) => s.line.trim() && !outOfCharacter(s.line)).slice(0, 3);
  return { dialogue: reply.dialogue.trim(), emotion, level, movement, relation, memory, resolves, suggestions, adjustments };
}

// ---------------------------------------------------------------- applying to story state

export const pairKey = bondKey;

/** Add a spoken line to the pair's conversation history. */
export function pushTalkLine(story: StoryState, a: string, b: string, line: TalkLine): StoryState {
  const key = pairKey(a, b);
  const list = [...(story.talk?.[key] ?? []), line].slice(-TALK_HISTORY_KEEP);
  return { ...story, talk: { ...(story.talk ?? {}), [key]: list } };
}

/** Similar enough to count as the same memory (merged instead of duplicated). */
export const SAME_MEMORY = 0.5;

function rememberNote(story: StoryState, who: Character, other: Character, m: NonNullable<ValidatedReply["memory"]>, note: string | null, source: "ai" | "mock", now: number): StoryState {
  const st = story.characters[who.id] ?? neutralState();
  // Same moment told again (or a near-identical summary): strengthen it, don't add a duplicate.
  const twin = note ? st.memories.find((x) => x.withId === other.id && x.note && similarity(x.note, note) >= SAME_MEMORY) : undefined;
  let memories: Memory[];
  if (twin) {
    memories = st.memories.map((x) => (x === twin ? { ...x, count: (x.count ?? 1) + 1, importance: Math.max(x.importance, m.importance), turn: story.turn, at: now, ...(m.thread && !x.thread ? { thread: m.thread } : {}) } : x));
    return { ...story, characters: { ...story.characters, [who.id]: { ...st, memories } } };
  }
  if (m.kind) {
    const r = remember(st, { kind: m.kind, withId: other.id, withName: other.name.trim(), turn: story.turn, importance: m.importance, eventType: `talk.${m.kind}` }, now);
    memories = r.state.memories.map((x) => (x.id === r.id ? { ...x, note: note ?? x.note, source, ...(m.thread ? { thread: m.thread, resolved: false } : {}) } : x));
    return { ...story, characters: { ...story.characters, [who.id]: { ...r.state, memories } } };
  }
  // A notable moment that fits no kind: keep the note itself.
  const mem: Memory = { id: `mem-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, turn: story.turn, eventType: "talk.note", count: 1, reaction: null, withId: other.id, withName: other.name.trim(), mood: st.mood, importance: m.importance, note, at: now, source, ...(m.thread ? { thread: m.thread, resolved: false } : {}) };
  return { ...story, characters: { ...story.characters, [who.id]: { ...st, memories: [...st.memories, mem].slice(-24) } } };
}

/**
 * Write a validated reply to story state: the listener's emotion, how they
 * now feel about the speaker, the memory (listener; the speaker keeps the
 * kind of moment too when it mattered), the settled thread, the line in the
 * pair's history, and the relationship shift log.
 */
export function applyReply(story: StoryState, v: ValidatedReply, listener: Character, speaker: Character, source: "ai" | "mock", now = Date.now()): StoryState {
  let s = story;
  // Emotion (the matching inner feeling rises with it, so the behavior engine sees it too).
  const st = s.characters[listener.id] ?? neutralState();
  s = { ...s, characters: { ...s.characters, [listener.id]: v.level === 0 ? withEmotion(st, "neutral", 0, now) : withEmotion(st, v.emotion, v.level, now) } };
  // Relationship (listener → speaker). applyRelation also clamps every value to its range.
  if (Object.keys(v.relation).length) {
    const before: Relation = relationOf(s, listener, speaker);
    s = withRelation(s, listener.id, speaker.id, applyRelation(before, v.relation as RelationDelta));
    const key = relKey(listener.id, speaker.id);
    const log = [...(s.relationLog?.[key] ?? []), { turn: s.turn, from: listener.id, to: speaker.id, delta: v.relation, why: (v.memory?.note ?? v.dialogue).slice(0, 140) }].slice(-RELATION_LOG_KEEP);
    s = { ...s, relationLog: { ...(s.relationLog ?? {}), [key]: log } };
  }
  // Memory.
  if (v.memory) {
    s = rememberNote(s, listener, speaker, v.memory, v.memory.note, source, now);
    if (v.memory.importance >= 2 && v.memory.kind) s = rememberNote(s, speaker, listener, v.memory, null, source, now);
  }
  if (v.resolves) {
    const l = s.characters[listener.id]!;
    s = { ...s, characters: { ...s.characters, [listener.id]: { ...l, memories: l.memories.map((m) => (m.id === v.resolves ? { ...m, resolved: true } : m)) } } };
  }
  // The line itself.
  return pushTalkLine(s, listener.id, speaker.id, { from: listener.id, text: v.dialogue, turn: s.turn, at: now, source });
}

// ---------------------------------------------------------------- memory inspector

export type MemoryPatch = { note?: string; resolved?: boolean; importance?: number };

/** The player corrects a memory (text, resolved, importance) or forgets it (patch = null). */
export function editMemory(story: StoryState, characterId: string, memoryId: string, patch: MemoryPatch | null): StoryState {
  const st = story.characters[characterId];
  if (!st) return story;
  const memories =
    patch === null
      ? st.memories.filter((m) => m.id !== memoryId)
      : st.memories.map((m) =>
          m.id === memoryId
            ? {
                ...m,
                ...(patch.note !== undefined ? { note: Array.from(patch.note.trim()).slice(0, 200).join("") || null, source: "player" as const } : {}),
                ...(patch.resolved !== undefined ? { resolved: patch.resolved } : {}),
                ...(patch.importance !== undefined ? { importance: Math.max(1, Math.min(3, Math.round(patch.importance))) } : {}),
              }
            : m,
        );
  return { ...story, characters: { ...story.characters, [characterId]: { ...st, memories } } };
}
