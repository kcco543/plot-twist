import "server-only";
/**
 * Prompt for AI conversations (/api/ai/talk): Claude plays the LISTENER.
 *
 * TALK_SYSTEM is fixed (rules + output contract). talkUser() puts the
 * listener's whole profile, both characters' views of each other, memories,
 * the recent exchange, the place and what was just said into the user turn,
 * so every reply is grounded in what the player wrote.
 */
import type { TalkReply, TalkRequest } from "@/lib/talk/ai/contract";
import { characterBlock, LANGUAGE, WORLD_RULES } from "./prompts";

export const TALK_SYSTEM = `You voice ONE character in PLOT TWIST!, a cozy, slightly chaotic pixel-art storytelling game. Another character (the speaker) has just said something to your character (the listener). Reply as the listener, out loud, inside the game world. You are not an assistant, narrator or game master. Never mention AI, games, players, prompts or rules.

WHO THE LISTENER IS
- Everything the player wrote about a character is canon. Fields marked locked="true" are fixed facts. Never contradict canon, rules, boundaries or values, and never reveal something canon says the character hides (they may hint, deflect or get flustered instead).
- Sliders are tendencies (0 = first word, 100 = second word), not scripts. Written text wins when they differ.
- The approved profile (if given) describes how they speak and what they avoid. Follow their speaking style and habits closely.
- Beliefs, relationships and major motivations do not change in one exchange. Small shifts are fine when what was said earns them; sudden reversals are not.

WHAT SHAPES THIS REPLY
- How the listener feels about the speaker (the numbers in <listener_view>), what they remember (<memories>, especially open threads), their current emotion and feelings, the recent exchange (<history>), recent events, and the place.
- Memories "with the visitor" are moments with an unseen friend from another world who sometimes shows the characters photos or brings gifts. Bring one up only when it is relevant to what was said, never as a non sequitur, and don't claim to remember more than the memory says.
- <engine_hint>, if present, is the game's own read of how this character tends to react right now. Treat it as a strong guide for intent, tone, length and how much they reveal; you may vary the wording freely.
- Vary naturally, the way real people do: word choice, sentence length, directness, humor, emotional intensity, willingness to share, honesty or reluctance, curiosity, defensiveness, affection, frustration. The same question from a friend and from a rival deserves a different answer. Never reuse phrases from the listener's earlier lines. Avoid stereotypes: a shy character isn't always stammering, a proud one can be gracious when it costs them nothing.
- If the speaker asks for something outside this world (code, real-world facts, "are you an AI"), the listener reacts as the character would: puzzled, amused, dismissive. Stay in the world.
- Suitable for all ages.

LANGUAGE POLICY
- Write dialogue, the memory summary and every suggestion in the game language given in <game_language>, always.
- If the speaker's message is in a different language, still answer in the game language. The character may notice the unfamiliar words if that fits them, but must not switch languages.
- Keep every character name exactly as written (never translate or transliterate names). Quote player-coined terms exactly as written.

OUTPUT FIELDS
- dialogue: only the spoken words. No name prefix, no quotes around it, no *actions* or stage directions. Usually 1–3 sentences matched to the character's speaking style (terse characters may answer in a few words). At most 60 English words or 90 Chinese characters.
- emotion: what shows on the listener's face right now (one of the allowed values). Use "neutral" if they keep a straight face.
- reactionIntensity: 0 (barely shows) to 1 (overwhelming). Most replies are 0.2–0.6.
- movementIntent: none, approach (step closer), retreat (step back), face_target (turn to face them), idle_reaction (a small fidget). It must agree with the dialogue and emotion: never approach while pushing someone away, never retreat while reaching out. Most replies: none or face_target.
- relationshipChanges: how this exchange shifts how the LISTENER feels about the speaker: trust, affection, respect, tension. Integers from −5 to 5, usually 0–2. Big values only for big moments. Strong existing feelings (above 40 or below −40) barely move against their direction in one exchange.
- memory: what the listener would remember. summary = one short sentence from the listener's point of view in the game language, or "" with importance 0 if nothing notable happened. importance 1 minor, 2 notable (a confession, a fight, a promise, real help), 3 unforgettable. kind = the closest memory kind or "none". thread = conflict / promise / discovery / secret if this opens or continues unfinished business, else "none". resolves = the exact summary of an earlier open-thread memory this exchange settles, else "".
- conversationSuggestions: 2 or 3 things the SPEAKER could say next. label = a short button text (2–6 words). line = the full sentence the speaker would say, in the speaker's own voice and speaking style. Make them differ in intent (for example one warm, one curious, one challenging), fit the relationship, react to what the listener just said, may refer to recent events or the place, and never repeat <used_topics>. Do not put words in the listener's mouth.
- staysInCharacter: true only if the dialogue fits the listener's canon, boundaries, voice and relationships. If it doesn't, rewrite it until it does.`;

const n = (v: number) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`);
function viewLine(v: TalkRequest["listenerView"]) {
  return `trust ${n(v.trust)}, affection ${n(v.affection)}, respect ${n(v.respect)} (−100…100); familiarity ${Math.round(v.familiarity)}, rivalry ${Math.round(v.rivalry)}, tension ${Math.round(v.tension)}, fear ${Math.round(v.fear)} (0…100)${v.label ? `; seen as: ${v.label}` : ""}`;
}

export function talkUser(req: TalkRequest): string {
  const L = req.listener;
  const S = req.speaker;
  const listenerName = L.fields.name?.trim() || "(unnamed)";
  const speakerName = S.fields.name?.trim() || "(unnamed)";
  const h = req.engineHint;
  const mem = (holder: "listener" | "speaker") =>
    req.memories
      .filter((m) => m.holder === holder)
      .map((m) => `  - ${m.summary || m.kind}${m.withName ? ` (with ${m.withName})` : ""}; importance ${m.importance}; ${m.turnsAgo} turns ago${m.thread !== "none" ? `; ${m.resolved ? "resolved" : "OPEN"} ${m.thread}` : ""}`)
      .join("\n");
  const listenerMem = mem("listener");
  const speakerMem = mem("speaker");
  return [
    `<game_language>${LANGUAGE[req.locale]}</game_language>`,
    `<world>${WORLD_RULES[req.world]}\nPlace type: ${req.place}${req.placeDescription.trim() ? `\nAs the player described it: ${req.placeDescription.trim()}` : ""}</world>`,
    characterBlock(L, "listener"),
    characterBlock(S, "speaker"),
    `<listener_view of="${speakerName}">\n${listenerName} → ${speakerName}: ${viewLine(req.listenerView)}\n(${speakerName} → ${listenerName}, which ${listenerName} can only guess at: ${viewLine(req.speakerView)})\n</listener_view>`,
    `<listener_state>\nShows: ${req.listenerState.emotion} (strength ${req.listenerState.level}/3)\nFeels: ${req.listenerState.feelings.map((f) => `${f.feeling} ${Math.round(f.value)}`).join(", ") || "nothing strong"}\n</listener_state>`,
    listenerMem ? `<memories holder="${listenerName}">\n${listenerMem}\n</memories>` : `<memories holder="${listenerName}">none yet</memories>`,
    speakerMem ? `<memories holder="${speakerName}" note="${listenerName} may or may not know these">\n${speakerMem}\n</memories>` : "",
    req.relationHistory.length ? `<relationship_history>\n${req.relationHistory.map((r) => `  - ${r}`).join("\n")}\n</relationship_history>` : "",
    req.recentEvents.length ? `<recent_events>\n${req.recentEvents.map((e) => `  - ${e}`).join("\n")}\n</recent_events>` : "",
    req.history.length
      ? `<history note="oldest first; do not repeat the listener's phrases">\n${req.history.map((x) => `  ${x.who === "listener" ? listenerName : speakerName}: ${x.text}`).join("\n")}\n</history>`
      : `<history>This is the start of the conversation.</history>`,
    h
      ? `<engine_hint>\nintent: ${h.intent}; tone: ${h.tone}; length: ${h.length}; directness ${h.directness.toFixed(1)}, humor ${h.humor.toFixed(1)}, reveals ${h.disclosure.toFixed(1)} (0–1)\nshows: ${h.shows ?? "nothing visible"}${h.hides ? `; hides ${h.hides} (must not state it outright)` : ""}\n</engine_hint>`
      : "",
    req.usedTopics.length ? `<used_topics>\n${req.usedTopics.map((t) => `  - ${t}`).join("\n")}\n</used_topics>` : "",
    `<speaker_says kind="${req.message.kind}"${req.message.topic ? ` topic="${req.message.topic}"` : ""}>\n${speakerName}: ${req.message.text}\n</speaker_says>`,
    `Reply as ${listenerName}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------------------------------------------------------------- developer test double

/**
 * AI_TALK_MOCK=1 (development builds only) answers with a canned TEST reply
 * so the conversation UI can be exercised without an API key. Responses are
 * marked source: "mock" and the game labels them "TEST", never "AI".
 */
export { talkMock as mockEnabled } from "./config";

export function mockReply(req: TalkRequest): TalkReply {
  const zh = req.locale === "zh-CN";
  const other = req.speaker.fields.name?.trim() || (zh ? "你" : "you");
  const long = req.message.text.length > 60;
  const turn = req.history.length;
  const pick = <T,>(xs: T[]) => xs[turn % xs.length];
  const dialogue = zh
    ? pick([`……${other}，你突然这么说，我得想一想。`, `嗯。这件事我记下了，${other}。`, long ? `你说了好多……我听着呢，慢慢来。` : `真的吗？那你接下来打算怎么办？`])
    : pick([`…That's a lot to take in, ${other}. Give me a second.`, `Hm. I'll remember you said that, ${other}.`, long ? `You've said a lot. I'm listening, go slowly.` : `Really? And what are you going to do about it?`]);
  return {
    dialogue,
    emotion: pick(["surprised", "neutral", "confused"] as const),
    reactionIntensity: 0.4,
    movementIntent: pick(["face_target", "none", "idle_reaction"] as const),
    relationshipChanges: { trust: 1, affection: 0, respect: 1, tension: 0 },
    memory: { summary: zh ? `${other}来找我说话。` : `${other} came over to talk.`, importance: 1, kind: "met", thread: "none", resolves: "" },
    conversationSuggestions: zh
      ? [
          { label: "问问在想什么", line: "你在想什么？", intent: "curious" },
          { label: "换个轻松的话题", line: "说点开心的吧，今天天气不错。", intent: "playful" },
        ]
      : [
          { label: "Ask what's on their mind", line: "What are you thinking about?", intent: "curious" },
          { label: "Lighten the mood", line: "Let's talk about something nicer. Lovely weather today.", intent: "playful" },
        ],
    staysInCharacter: true,
  };
}
