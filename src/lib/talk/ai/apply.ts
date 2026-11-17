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
import { relationOf, relKey, type RelationDelta } from "../../mind/relations";
import { DISCLOSING, type RequestDecision } from "../../relationships/boundaries";

/** Decisions that say no (or not now): the game, not the reply, decides what they do to the relationship. */
const REFUSING: Intention[] = ["hesitate", "refuse_polite", "refuse_firm", "explain_boundary", "deflect", "change_subject", "question_intent", "express_discomfort", "end_conversation"];
import { classifyMessage } from "../../relationships/classify";
import { blendProposal, progressOf, recordInteraction } from "../../relationships/progression";
import { stageIndex } from "../../relationships/stages";
import type { Intention, InteractionKind, Significance } from "../../relationships/types";
import { bondKey, neutralState } from "../../story/engine";
import { similarity } from "../../story/similarity";
import type { Character, Memory, MemoryKind, MemoryThread, RelationShift, StoryState, TalkLine } from "../../types";

const distressedOf = (story: StoryState, id: string) => {
  const f = story.characters[id]?.feelings ?? {};
  return Math.max(f.sadness ?? 0, f.anxiety ?? 0, f.fear ?? 0) >= 40;
};
import { outOfCharacter, overclaims } from "./checks";
export { overclaims };
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
  /** What the listener did with the request (checked against the game's decision). */
  stance: Intention;
  /** The validated interaction (what the speaker did), for relationship progression. */
  /** skip: the game already recorded what this moment means (a refused request), so the reply adds nothing on top. */
  interaction: { kind: InteractionKind; proposedKind: InteractionKind; significance: Significance; reasons: string[]; skip?: boolean };
  /** Set when the reply broke a binding decision; nothing from it is applied. */
  rejected: null | "stance_not_allowed" | "disclosed_against_decision" | "overclaims_trust";
};

const WARM: Emotion[] = ["happy", "excited", "affectionate"];
const HOT: Emotion[] = ["angry", "frustrated"];
const THREAD_KIND: Record<MemoryThread, MemoryKind> = { conflict: "argument", promise: "promise", secret: "secret", discovery: "cooperated" };

export type ValidateContext = {
  listener: Character;
  speaker: Character;
  story: StoryState;
  /** What the speaker said (the game's own evidence for what happened). */
  message?: string;
  /** The game's decision about what the listener is willing to do (binding). */
  decision?: RequestDecision | null;
};

/** Kinds with big consequences: accepted from the AI only when what was said supports them. */
const NEEDS_EVIDENCE: InteractionKind[] = ["help", "rescue", "keep_promise", "break_promise", "make_promise", "share_secret", "betrayal", "threat", "insult", "apology", "shared_experience", "cooperate", "argument", "criticize"];
/** Same family: evidence for one supports the other. */
const RELATED: Partial<Record<InteractionKind, InteractionKind[]>> = { rescue: ["help"], cooperate: ["help"], argument: ["criticize", "insult", "provoke"], criticize: ["insult", "argument"], shared_experience: ["cooperate", "help"] };



/**
 * Validate the AI's reading of what the speaker did. The game's classifier is
 * the evidence: a big kind needs support in the actual words; when the words
 * clearly say something (an apology, a threat) that wins over the AI's label.
 */
export function validateInteraction(reply: Pick<TalkReply, "interpretation">, message: string | undefined): { kind: InteractionKind; proposedKind: InteractionKind; significance: Significance; reasons: string[] } {
  const reasons: string[] = [];
  const ai = reply.interpretation?.interaction;
  const proposedKind: InteractionKind = !ai || ai === "none" ? "small_talk" : ai;
  let significance: Significance = reply.interpretation?.significance ?? "ordinary";
  const found = message ? classifyMessage(message) : [];
  let kind = proposedKind;
  const supported = (k: InteractionKind) => found.includes(k) || (RELATED[k] ?? []).some((r) => found.includes(r));
  if (NEEDS_EVIDENCE.includes(kind) && !supported(kind)) {
    reasons.push(`ai:${kind}_not_supported_by_words`);
    kind = found[0] ?? "small_talk";
    if (significance === "major" || significance === "meaningful") {
      significance = "ordinary";
      reasons.push("ai:significance_downgraded");
    }
  } else if (kind === "small_talk" && found.length) {
    kind = found[0];
    reasons.push(`words:${kind}`);
  }
  if (significance === "major" && !(message && Array.from(message).length >= 12)) {
    significance = "meaningful";
    reasons.push("ai:major_needs_substance");
  }
  return { kind, proposedKind, significance, reasons };
}

/**
 * The emotion a character may show: only allowed emotions; strength from
 * intensity, capped for reserved characters; canon masks ("never admits her
 * feelings") hide what the character wouldn't show; an angry character
 * doesn't flip to beaming in one line. Shared by conversations and photos.
 */
export function checkEmotion(character: Character, story: StoryState, proposed: Emotion, rawIntensity: number, adjustments: string[]): { emotion: Emotion; level: 0 | EmotionLevel } {
  const p = personalityOf(character);
  const canon = canonLimits(character);
  const before = emotionOf(story.characters[character.id]);
  let emotion: Emotion = proposed;
  const intensity = Number.isFinite(rawIntensity) ? Math.max(0, Math.min(1, rawIntensity)) : 0.4;
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
  return { emotion, level };
}

export function validateReply(reply: TalkReply, ctx: ValidateContext): ValidatedReply {
  const { listener, speaker, story } = ctx;
  const adjustments: string[] = [];
  const canon = canonLimits(listener);
  const rel = relationOf(story, listener, speaker);

  // ---- emotion
  const { emotion, level } = checkEmotion(listener, story, reply.emotion, reply.reactionIntensity, adjustments);

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

  // ---- the game's decision is binding: the AI words it, it doesn't overrule it
  const stance: Intention = reply.stance ?? "respond_freely";
  let rejected: ValidatedReply["rejected"] = null;
  const d = ctx.decision;
  if (d && d.intention !== "respond_freely") {
    if (d.disclosure === "none" && DISCLOSING.includes(stance)) rejected = "disclosed_against_decision";
    else if (!d.allowed.includes(stance) && stance !== "respond_freely") rejected = "stance_not_allowed";
    else if (stance === "respond_freely" && d.disclosure === "none") rejected = "stance_not_allowed";
  }
  const prog = progressOf(story, listener, speaker);
  if (!rejected && overclaims(reply.dialogue) && stageIndex("trust", prog.stages.trust) < 4) rejected = "overclaims_trust";
  if (rejected) adjustments.push(`decision:${rejected}`);
  const interaction: ValidatedReply["interaction"] = validateInteraction(reply, ctx.message);
  // A refusal was already scored by the game (applyDecisionOutcome: pressure, boundary pushes,
  // respect for letting it go). The reply's own reading of the moment must not add warmth on top.
  if (d && REFUSING.includes(d.intention)) {
    interaction.skip = true;
    interaction.reasons.push("decision:refusal_already_recorded");
  }
  return { dialogue: rejected ? "" : reply.dialogue.trim(), emotion, level, movement, relation, memory, resolves, suggestions, adjustments, stance, interaction, rejected };
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
  // Relationship (listener → speaker): the validated interaction goes through the progression
  // rules. The AI's numbers are only a proposal; affectionate words alone move nothing.
  if (!v.interaction.skip) {
    const { proposed, ignoredWarmth } = blendProposal(v.interaction.kind, v.relation as RelationDelta, v.interaction.significance);
    const reasons = [...v.interaction.reasons, ...(ignoredWarmth ? ["ai:warmer_numbers_ignored"] : [])];
    const res = recordInteraction(s, { from: listener, to: speaker, kind: v.interaction.kind, proposedKind: v.interaction.proposedKind, significance: v.interaction.significance, proposed, source: source === "ai" ? "talk-ai" : "talk-mock", why: (v.memory?.note ?? v.dialogue).slice(0, 140), reasons, distressed: distressedOf(story, listener.id), now });
    s = res.story;
    const accepted = res.change?.accepted ?? {};
    const delta = Object.fromEntries(AI_RELATION_KEYS.filter((k) => accepted[k]).map((k) => [k, accepted[k]])) as RelationShift["delta"];
    if (Object.keys(delta).length) {
      const key = relKey(listener.id, speaker.id);
      const log = [...(s.relationLog?.[key] ?? []), { turn: s.turn, from: listener.id, to: speaker.id, delta, why: (v.memory?.note ?? v.dialogue).slice(0, 140) }].slice(-RELATION_LOG_KEEP);
      s = { ...s, relationLog: { ...(s.relationLog ?? {}), [key]: log } };
    }
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
