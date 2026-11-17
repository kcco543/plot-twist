/**
 * AUTONOMOUS CONVERSATIONS — contract with /api/ai/converse.
 * --------------------------------------------------------------------------
 * One request writes one short, bounded conversation between two
 * characters (both voices, in order). The game reveals the turns one by
 * one, and nothing (emotion, relationship, memory) changes until a turn or
 * the whole conversation is actually committed (convoDirector.ts).
 *
 * The reply only PROPOSES: speakers are "a"/"b" (never names or ids), the
 * game clamps the turn count, the lengths and every number, validates the
 * interaction kinds against what was actually said, and decides what
 * changes (applyOutcome in autonomy/convoDirector.ts). This is the only
 * place autonomous behaviour reaches an AI, and only through the writer the
 * director is given (useAutoConversations.ts): once per accepted conversation.
 */
import { z } from "zod";
import { briefFor } from "../../ai/client";
import { CharacterBriefSchema } from "../../ai/contracts";
import { emotionOf, EMOTIONS } from "../../emotion/emotions";
import { feelingsOf, ranked } from "../../mind/feelings";
import { relationOf } from "../../mind/relations";
import { INTERACTION_KINDS, SIGNIFICANCE } from "../../relationships/types";
import { relationshipSummary } from "../../relationships/summary";
import { pickMemories } from "./request";
import { pairKey } from "./apply";
import { MEMORY_THREADS, TalkMemorySchema } from "./contract";
import { MEMORY_KINDS, type Character, type EnvironmentTypeId, type StoryState, type WorldId } from "../../types";
import { AUTO_CONVO, TOPIC_KINDS, type AutoConvo } from "../../autonomy/convo";

const text = (max: number) => z.string().max(max);
const cut = (s: string, n: number) => Array.from(s).slice(0, n).join("");

const ViewSchema = z.object({
  trust: z.number().min(-100).max(100),
  affection: z.number().min(-100).max(100),
  respect: z.number().min(-100).max(100),
  familiarity: z.number().min(0).max(100),
  tension: z.number().min(0).max(100),
  fear: z.number().min(0).max(100),
});

const SideSchema = z.object({
  brief: CharacterBriefSchema,
  /** How this one sees the other. */
  view: ViewSchema,
  relationship: z.object({ label: text(30), conflicts: z.array(text(120)).max(3), promises: z.array(text(160)).max(3), milestones: z.array(text(120)).max(4) }),
  state: z.object({ emotion: z.enum(EMOTIONS), level: z.number().int().min(1).max(3), feelings: z.array(z.object({ feeling: text(20), value: z.number().min(0).max(100) })).max(4) }),
  /** What they're doing right now (short, plain words), if anything. */
  doing: text(80),
});

export const ConverseRequestSchema = z.object({
  locale: z.enum(["en", "zh-CN"]),
  world: z.enum(["western-fantasy", "modern", "ancient-china", "otherworld"]),
  place: z.enum(["interior", "street", "wilderness", "ruins", "dreamscape"]),
  placeDescription: text(500),
  /** a = who started it, b = who was approached. */
  a: SideSchema,
  b: SideSchema,
  topic: z.object({ kind: z.enum(TOPIC_KINDS), about: text(160) }),
  /** Why a went over (plain words). */
  reason: text(80),
  /** How b took the approach (b already agreed to talk). */
  willingness: z.enum(["glad", "willing", "reluctant"]),
  turns: z.object({ min: z.number().int().min(2).max(AUTO_CONVO.maxTurns), max: z.number().int().min(2).max(AUTO_CONVO.maxTurns) }),
  /** Recent lines between them, oldest first. */
  history: z.array(z.object({ who: z.enum(["a", "b"]), text: text(360) })).max(8),
  memories: z.array(TalkMemorySchema).max(8),
  recentEvents: z.array(text(200)).max(4),
});
export type ConverseRequest = z.infer<typeof ConverseRequestSchema>;

const ViewReply = z.object({
  /** What the OTHER one did in this conversation, as this one experienced it. */
  interaction: z.enum([...INTERACTION_KINDS, "none"]),
  significance: z.enum(SIGNIFICANCE),
  /** Proposed nudges to how THIS one feels about the other, about −3…3 each. */
  trust: z.number(),
  affection: z.number(),
  respect: z.number(),
  tension: z.number(),
  memory: z.object({ summary: z.string(), importance: z.number(), kind: z.enum([...MEMORY_KINDS, "none"]), thread: z.enum(MEMORY_THREADS) }),
});

/** What Claude returns (structured outputs; ranges and lengths are enforced after parsing). */
export const ConverseReplySchema = z.object({
  turns: z.array(z.object({ speaker: z.enum(["a", "b"]), text: z.string(), emotion: z.enum(EMOTIONS), intensity: z.number() })),
  /** Who brought it to a close, and whether they walked off. */
  endedBy: z.enum(["a", "b"]),
  how: z.enum(["natural", "walks_off"]),
  /** What it turned out to be about, a few words. */
  topic: z.string(),
  a: ViewReply,
  b: ViewReply,
  staysInCharacter: z.boolean(),
});
export type ConverseReply = z.infer<typeof ConverseReplySchema>;
export type ConverseResponse = { reply: ConverseReply; source: "ai" | "mock"; model: string };

// ---------------------------------------------------------------- building

export type ConverseBuild = {
  story: StoryState;
  convo: AutoConvo;
  a: Character;
  b: Character;
  locale: string;
  world: WorldId;
  place: EnvironmentTypeId;
  placeDescription: string;
  recentEvents: string[];
  doing: (id: string) => string;
  reasonText: string;
};

function side(story: StoryState, me: Character, other: Character, doing: string): ConverseRequest["a"] {
  const v = relationOf(story, me, other);
  const em = emotionOf(story.characters[me.id]);
  const r = relationshipSummary(story, me, other);
  return {
    brief: briefFor(me),
    view: { trust: v.trust, affection: v.affection, respect: v.respect, familiarity: v.familiarity, tension: v.tension, fear: v.fear },
    relationship: { label: cut(r.label, 30), conflicts: r.conflicts.slice(0, 3).map((c) => cut(c, 120)), promises: r.promises.slice(0, 3).map((c) => cut(c, 160)), milestones: r.milestones.slice(0, 4).map((c) => cut(c, 120)) },
    state: {
      emotion: em.emotion,
      level: em.level,
      feelings: ranked(feelingsOf(story.characters[me.id]))
        .slice(0, 4)
        .map(([feeling, value]) => ({ feeling, value: Math.max(0, Math.min(100, value)) })),
    },
    doing: cut(doing, 80),
  };
}

export function buildConverseRequest(i: ConverseBuild): ConverseRequest {
  const { story, a, b, convo } = i;
  const hist = (story.talk?.[pairKey(a.id, b.id)] ?? [])
    .filter((l) => l.from === a.id || l.from === b.id)
    .slice(-8)
    .map((l) => ({ who: (l.from === a.id ? "a" : "b") as "a" | "b", text: cut(l.text, 360) }));
  // B's memories with A ("listener"), then A's with B ("speaker").
  const memories = pickMemories(story, b, a).slice(0, 8);
  return {
    locale: i.locale === "zh-CN" ? "zh-CN" : "en",
    world: i.world,
    place: i.place,
    placeDescription: cut(i.placeDescription, 500),
    a: side(story, a, b, i.doing(a.id)),
    b: side(story, b, a, i.doing(b.id)),
    topic: { kind: convo.topic.kind, about: cut(convo.topic.about, 160) },
    reason: cut(i.reasonText, 80),
    willingness: convo.willingness ?? "willing",
    turns: { min: Math.max(2, Math.min(convo.minTurns, convo.maxTurns)), max: Math.max(2, convo.maxTurns) },
    history: hist,
    memories,
    recentEvents: i.recentEvents.slice(-4).map((e) => cut(e, 200)),
  };
}

// ---------------------------------------------------------------- sending

export type ConverseErrorCode = "not_configured" | "refused" | "invalid_output" | "rate_limited" | "auth" | "failed" | "offline" | "timeout" | "busy" | "limit" | "bad_request" | "too_large" | "cancelled" | "billing" | "ai_off" | "budget" | "beta_locked" | "quota";
export type ConverseResult = { ok: true; data: ConverseResponse } | { ok: false; code: ConverseErrorCode };

export const CONVERSE_CLIENT_TIMEOUT_MS = 40_000;

/** POST the request. Never throws. */
export async function sendConverseRequest(req: ConverseRequest, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<ConverseResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), CONVERSE_CLIENT_TIMEOUT_MS);
  const onAbort = () => ctrl.abort("cancelled");
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetchImpl("/api/ai/converse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req), signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, code: (data?.error as ConverseErrorCode) ?? "failed" };
    const reply = ConverseReplySchema.safeParse(data?.reply);
    if (!reply.success || (data.source !== "ai" && data.source !== "mock")) return { ok: false, code: "invalid_output" };
    return { ok: true, data: { reply: reply.data, source: data.source, model: String(data.model ?? "") } };
  } catch {
    if (ctrl.signal.aborted) return { ok: false, code: ctrl.signal.reason === "cancelled" ? "cancelled" : "timeout" };
    return { ok: false, code: "offline" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
