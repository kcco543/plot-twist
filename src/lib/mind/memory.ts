/**
 * MEMORY MANAGER — meaningful moments that shape later behavior.
 * --------------------------------------------------------------------------
 * Uses the same Memory list the story engine already keeps per character
 * (CharacterState.memories), adding a `kind`. A repeat of the same kind of
 * moment with the same person inside MERGE_TURNS is merged into the existing
 * memory (count + 1, importance may rise) instead of creating a duplicate.
 * Memories never change personality; they feed the decision as features.
 */
import { makeId } from "../id";
import type { CharacterState, Memory, MemoryKind } from "../types";

export const MAX_MEMORIES = 24;
/** Same kind + same person within this many turns = the same memory, strengthened. */
export const MERGE_TURNS = 8;
/** A memory's pull halves every this many turns. */
export const MEMORY_HALF_LIFE = 20;

/** Kinds that contradict each other: recording one weakens a recent one of the other (e.g. complimented after criticized). */
const OPPOSITE: Partial<Record<MemoryKind, MemoryKind>> = { complimented: "criticized", criticized: "complimented", helped: "rejected", rejected: "helped" };

/** Story-engine memories (no kind) mapped from their event type. */
const EVENT_KIND: Record<string, MemoryKind> = {
  argument: "argument",
  kindness: "helped",
  confide: "secret",
  rivalry: "provoked",
  tease: "teased",
  misunderstanding: "argument",
  askHelp: "helped",
};
export const memoryKindOf = (m: Memory): MemoryKind | null => m.kind ?? EVENT_KIND[m.eventType] ?? null;

/** Add (or merge) a memory. Returns the new state and the memory id. */
export function remember(
  state: CharacterState,
  m: { kind: MemoryKind; withId: string | null; withName: string; turn: number; importance: number; eventType?: string },
  now = Date.now(),
): { state: CharacterState; id: string; merged: boolean } {
  const existing = [...state.memories]
    .reverse()
    .find((x) => memoryKindOf(x) === m.kind && x.withId === m.withId && m.turn - x.turn <= MERGE_TURNS);
  if (existing) {
    const count = (existing.count ?? 1) + 1;
    const importance = Math.min(3, Math.max(existing.importance, m.importance) + (count === 3 ? 1 : 0));
    const memories = state.memories.map((x) => (x === existing ? { ...x, kind: m.kind, count, importance, turn: m.turn, at: now } : x));
    return { state: { ...state, memories }, id: existing.id, merged: true };
  }
  let memories = state.memories;
  const opp = OPPOSITE[m.kind];
  if (opp) {
    // A contradicting recent memory with the same person fades instead of both pulling at full strength.
    memories = memories.map((x) => (memoryKindOf(x) === opp && x.withId === m.withId && m.turn - x.turn <= MERGE_TURNS && x.importance > 1 ? { ...x, importance: x.importance - 1 } : x));
  }
  const id = makeId("mem");
  memories = [
    ...memories,
    { id, turn: m.turn, eventType: m.eventType ?? m.kind, kind: m.kind, count: 1, reaction: null, withId: m.withId, withName: m.withName, mood: state.mood, importance: Math.min(3, Math.max(1, m.importance)), note: null, at: now },
  ];
  if (memories.length > MAX_MEMORIES) {
    const drop = [...memories].sort((a, b) => a.importance - b.importance || a.turn - b.turn)[0];
    memories = memories.filter((x) => x !== drop);
  }
  return { state: { ...state, memories }, id, merged: false };
}

/** 0–1 pull of each memory kind toward `otherId`, recent and important memories pulling harder. */
export function memoryPull(state: CharacterState | undefined, otherId: string | null, turn: number): Partial<Record<MemoryKind, number>> {
  const out: Partial<Record<MemoryKind, number>> = {};
  if (!state || !otherId) return out;
  for (const m of state.memories) {
    if (m.withId !== otherId) continue;
    const kind = memoryKindOf(m);
    if (!kind) continue;
    const recency = Math.pow(0.5, Math.max(0, turn - m.turn) / MEMORY_HALF_LIFE);
    const strength = (m.importance / 3) * recency * Math.min(1.5, 0.75 + 0.25 * (m.count ?? 1));
    out[kind] = Math.min(1, (out[kind] ?? 0) + strength);
  }
  return out;
}

/** Memories with this person, strongest first (for the debug panel and the AI brief). */
export function relevantMemories(state: CharacterState | undefined, otherId: string | null, n = 5): Memory[] {
  if (!state || !otherId) return [];
  return state.memories
    .filter((m) => m.withId === otherId && memoryKindOf(m))
    .sort((a, b) => b.importance - a.importance || b.turn - a.turn)
    .slice(0, n);
}
