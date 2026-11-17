import "server-only";
/**
 * Prompt for autonomous conversations (/api/ai/converse): one call writes a
 * short, bounded exchange between two characters, both voices, in order.
 * The game already decided that it happens, who started it, that B agreed,
 * and roughly how long it may run. Claude words it and may end it early.
 */
import type { ConverseReply, ConverseRequest } from "@/lib/talk/ai/converse";
import { AUTO_CONVO } from "@/lib/autonomy/convo";
import { cleanDialogue, cutText, inLanguage, outOfCharacter } from "@/lib/talk/ai/checks";
import { isRepeat } from "@/lib/story/similarity";
import { characterBlock, LANGUAGE, WORLD_RULES } from "./prompts";

export const CONVERSE_SYSTEM = `You write ONE short conversation between two characters in PLOT TWIST!, a cozy, slightly chaotic pixel-art storytelling game. Nobody is talking to the player: the player is quietly watching two characters living their own lives. Character "a" started the conversation; character "b" agreed to talk. Write what they say to each other out loud, in order. You are not an assistant or narrator. Never mention AI, games, players, prompts or rules.

WHAT COMES FIRST (highest first)
1. Each character's locked canon and boundaries. Never crossed, never revealed: a secret stays secret (they may deflect, change the subject or go quiet).
2. Their values, beliefs, motivations and stable personality (profile, sliders, approved profile, speaking style).
3. Their memories and shared history, including earlier conflicts, refusals and promises.
4. How each sees the other (<view>, <relationship>): never closer than that. One conversation does not make them close friends.
5. How each feels right now, and what each was doing.
6. The topic and the reason "a" came over.

TWO INDEPENDENT PEOPLE
- Each line comes from the character saying it, reacting to what was actually just said. Every line must follow from the previous one: no unrelated lines, no two monologues.
- They can agree, disagree, ask questions, tease, change the subject, reveal a little, keep things to themselves, or end the conversation. Trust is not obedience. Disagreement and awkwardness are fine outcomes.
- No flattery spirals, no sudden confessions, no instant friendship. A reserved or shy character says less; a talkative one more. Introverts are not mute; extroverts are not always warm.
- "willingness" says how b took the approach: reluctant means b is short with a and may wrap things up soon.
- Shape: an opening from a, b's response, a follow-up, possibly a disagreement or a new topic, and a natural close. Somebody ends it for a reason that fits them (they have something to do, they've said enough, it got uncomfortable). If someone walks off, say so with how = "walks_off" and endedBy = that person.
- Turn count: between <turns min> and <turns max> lines in total. Fewer is right when a character has a real reason to stop (mood, boundaries, it's going badly). Never more than max.
- Speakers alternate a / b (a line may follow the same speaker only if the other said nothing worth answering). The first line is a's.

STYLE
- Lines are spoken words only: no names, no quotes, no *actions*, no stage directions. Usually one or two short sentences; at most 40 English words or 60 Chinese characters per line.
- Use each character's own voice and habits. Don't reuse phrases from <history>.
- Stay inside the world (see <world>). Suitable for all ages.
- Write every line, the topic and the memory summaries in the language given in <game_language>. Keep names exactly as written.

FIELDS
- turns: { speaker: "a" | "b", text, emotion (what shows on their face as they say it), intensity 0..1 (most 0.2–0.5) }.
- endedBy, how: who brought it to a close and whether they walked off.
- topic: what it turned out to be about, a few words.
- a and b: each one's take-away about the OTHER. interaction = the closest kind of what the other did (small_talk is the usual answer), significance (most: trivial or ordinary; meaningful only when something real happened), trust / affection / respect / tension = proposed nudges, integers −3…3, usually 0 or ±1 (the game decides the real change), memory = what they'd remember: summary one short sentence from their point of view, or "" with importance 0 for ordinary chat; importance 1 minor, 2 notable; kind, thread ("none" if nothing open).
- staysInCharacter: true only if every line fits its speaker's canon, boundaries, voice and relationship.`;

const n = (v: number) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`);

function viewBlock(r: ConverseRequest, who: "a" | "b", me: string, other: string) {
  const s = r[who];
  const v = s.view;
  const lines = [
    `${me} → ${other}: trust ${n(v.trust)}, affection ${n(v.affection)}, respect ${n(v.respect)} (−100…100); familiarity ${Math.round(v.familiarity)}, tension ${Math.round(v.tension)}, fear ${Math.round(v.fear)} (0…100). Overall: ${s.relationship.label.replace(/_/g, " ")}.`,
    ...s.relationship.conflicts.map((c) => `Unresolved: ${c}`),
    ...s.relationship.promises.map((p) => `Promise: ${p}`),
    ...s.relationship.milestones.map((m) => `Shared history: ${m}`),
    `Shows: ${s.state.emotion} (strength ${s.state.level}/3). Feels: ${s.state.feelings.map((f) => `${f.feeling} ${Math.round(f.value)}`).join(", ") || "nothing strong"}.`,
    s.doing ? `Was: ${s.doing}.` : "",
  ].filter(Boolean);
  return `<view of="${me}">\n${lines.map((l) => `  - ${l}`).join("\n")}\n</view>`;
}

/** The user turn: a stable prefix (profiles; cached) and the rest. */
export function converseParts(r: ConverseRequest): { prefix: string; rest: string } {
  const A = r.a.brief.fields.name?.trim() || "(unnamed)";
  const B = r.b.brief.fields.name?.trim() || "(unnamed)";
  const prefix = [
    `<game_language>${LANGUAGE[r.locale]}</game_language>`,
    `<world>${WORLD_RULES[r.world]}\nPlace type: ${r.place}${r.placeDescription.trim() ? `\nAs the player described it: ${r.placeDescription.trim()}` : ""}</world>`,
    characterBlock(r.a.brief, "a"),
    characterBlock(r.b.brief, "b"),
  ].join("\n\n");
  const mem = r.memories.map((m) => `  - ${m.holder === "listener" ? B : A} remembers: ${m.summary || m.kind}${m.withName ? ` (with ${m.withName})` : ""}; importance ${m.importance}; ${m.turnsAgo} turns ago${m.thread !== "none" ? `; ${m.resolved ? "resolved" : "OPEN"} ${m.thread}` : ""}`).join("\n");
  const rest = [
    viewBlock(r, "a", A, B),
    viewBlock(r, "b", B, A),
    mem ? `<memories>\n${mem}\n</memories>` : `<memories>none yet</memories>`,
    r.recentEvents.length ? `<recent_events>\n${r.recentEvents.map((e) => `  - ${e}`).join("\n")}\n</recent_events>` : "",
    r.history.length ? `<history note="earlier lines between them, oldest first; don't repeat them">\n${r.history.map((h) => `  ${h.who === "a" ? A : B}: ${h.text}`).join("\n")}\n</history>` : `<history>They haven't talked before (or not recently).</history>`,
    `<setup>\n  a = ${A} (started it). Why: ${r.reason}.\n  b = ${B}. Took it: ${r.willingness}.\n  Topic to start from: ${r.topic.kind} — ${r.topic.about}.\n  <turns min="${r.turns.min}" max="${r.turns.max}"/>\n</setup>`,
    `Write the conversation.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { prefix, rest };
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);

/**
 * First-pass clean-up: speakers a/b only, a first, no back-to-back repeats of
 * the same speaker merging into a monologue, lines tidied and cut, numbers
 * clamped, at most `max` turns. Lines that break character or repeat recent
 * history are dropped (a conversation that loses too much is rejected by the route).
 */
export function sanitizeConverse(reply: ConverseReply, r: ConverseRequest): ConverseReply {
  const names = { a: r.a.brief.fields.name ?? "", b: r.b.brief.fields.name ?? "" };
  const recent = r.history.map((h) => h.text);
  const turns: ConverseReply["turns"] = [];
  for (const t of reply.turns) {
    const text = cutText(cleanDialogue(t.text, names[t.speaker]), AUTO_CONVO.lineMax);
    if (!text || outOfCharacter(text) || isRepeat(text, [...recent, ...turns.map((x) => x.text)], 0.7)) continue;
    const prev = turns[turns.length - 1];
    if (!prev && t.speaker !== "a") continue;
    if (prev && prev.speaker === t.speaker) {
      // Two lines in a row from one speaker: join them (still one turn).
      if (Array.from(prev.text + text).length <= AUTO_CONVO.lineMax) prev.text = `${prev.text} ${text}`;
      continue;
    }
    turns.push({ speaker: t.speaker, text, emotion: t.emotion, intensity: clamp(t.intensity, 0, 1) });
    if (turns.length >= Math.min(r.turns.max, AUTO_CONVO.maxTurns)) break;
  }
  const view = (v: ConverseReply["a"]): ConverseReply["a"] => ({
    ...v,
    trust: Math.round(clamp(v.trust, -3, 3)),
    affection: Math.round(clamp(v.affection, -3, 3)),
    respect: Math.round(clamp(v.respect, -3, 3)),
    tension: Math.round(clamp(v.tension, -3, 3)),
    memory: { ...v.memory, summary: cutText(v.memory.summary.trim(), 200), importance: Math.round(clamp(v.memory.importance, 0, 2)) },
  });
  return { ...reply, turns, topic: cutText(reply.topic.trim(), 60), a: view(reply.a), b: view(reply.b) };
}

export type ConverseProblem = "too_short" | "wrong_language" | "self_check";

export function converseProblem(reply: ConverseReply, r: ConverseRequest): ConverseProblem | null {
  if (reply.turns.length < 2) return "too_short";
  const names = [r.a.brief.fields.name ?? "", r.b.brief.fields.name ?? ""].filter(Boolean);
  if (reply.turns.some((t) => !inLanguage(t.text, r.locale, names))) return "wrong_language";
  if (!reply.staysInCharacter) return "self_check";
  return null;
}

export const CONVERSE_FEEDBACK: Record<ConverseProblem, string> = {
  too_short: "The conversation had fewer than two usable lines. Write at least two lines that respond to each other, starting with a.",
  wrong_language: "Some lines were not in the game language. Write every line in the language given in <game_language>.",
  self_check: "A line did not fit its speaker. Rewrite so every line matches the speaker's canon, boundaries, voice and relationship.",
};

// ---------------------------------------------------------------- developer test double

/** AI_TALK_MOCK=1 (development only): a canned, clearly marked TEST conversation. */
export function mockConverse(r: ConverseRequest): ConverseReply {
  const zh = r.locale === "zh-CN";
  const A = r.a.brief.fields.name?.trim() || "A";
  const B = r.b.brief.fields.name?.trim() || "B";
  const lines: [("a" | "b"), string][] = zh
    ? [
        ["a", `${B}，有空聊两句吗？（测试）`],
        ["b", r.willingness === "reluctant" ? "……一会儿就好。（测试）" : `嗯，怎么了，${A}？（测试）`],
        ["a", `我刚在想${r.topic.about}。（测试）`],
        ["b", "我倒没怎么想过。你怎么看？（测试）"],
        ["a", "说不好，就是有点在意。（测试）"],
        ["b", "那改天再聊吧，我先忙一下。（测试）"],
      ]
    : [
        ["a", `Got a minute, ${B}? (TEST)`],
        ["b", r.willingness === "reluctant" ? "…A minute, sure. (TEST)" : `Sure. What's up, ${A}? (TEST)`],
        ["a", `I was just thinking about ${r.topic.about}. (TEST)`],
        ["b", "I hadn't really. What about it? (TEST)"],
        ["a", "Not sure yet. It's just on my mind. (TEST)"],
        ["b", "Let's pick it up later, I've got things to do. (TEST)"],
      ];
  const count = Math.max(r.turns.min, Math.min(r.turns.max, r.willingness === "reluctant" ? 2 : 4 + (r.history.length % 3)));
  const turns = Array.from({ length: Math.min(count, lines.length) }, (_, i) => ({ speaker: lines[i][0], text: lines[i][1], emotion: (i === 0 ? "happy" : "neutral") as "happy" | "neutral", intensity: 0.3 }));
  const view = { interaction: "small_talk" as const, significance: "ordinary" as const, trust: 0, affection: 1, respect: 0, tension: 0, memory: { summary: "", importance: 0, kind: "none" as const, thread: "none" as const } };
  return { turns, endedBy: turns[turns.length - 1].speaker, how: "natural", topic: zh ? "闲聊（测试）" : "small talk (TEST)", a: view, b: view, staysInCharacter: true };
}
