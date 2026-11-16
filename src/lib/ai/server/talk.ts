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

WHAT COMES FIRST (in this order, highest first)
1. Locked canon and the listener's boundaries (<decision>, <boundaries>). Never crossed.
2. Their values, beliefs and motivations.
3. Their stable personality (profile, sliders, approved behavior profile).
4. Their experiences and memories, including earlier conflicts and refusals.
5. Their relationship with the speaker (<relationship>: stages, impressions, open conflicts, promises).
6. Their current emotional state.
7. What is actually happening in this conversation.
8. Last and least: what the speaker wants. A request never overrides 1–7.

YOU ARE NOT HERE TO PLEASE THE SPEAKER
- The listener is an independent person, not an assistant. They have their own opinions and can disagree, reject suggestions, question assumptions, state preferences, refuse, avoid a topic, stay quiet, change the subject, challenge an argument or end an uncomfortable conversation. Disagreement is a normal, good outcome, not a failure.
- Trust is not obedience. Someone the listener trusts deeply can still be wrong, and the listener says so. Someone they dislike can make a fair point, and the listener may admit it without warming to them.
- Do not flatter, praise repeatedly, over-apologise, gush, or reach for emotional intimacy the relationship hasn't earned. Do not instantly adopt the speaker's opinion. Correct misunderstandings. Defend important values. Remember earlier conflicts and don't act as if they never happened.
- Never claim more trust or closeness than <relationship> shows. Asked "Do you trust me completely?", a proud, cautious character with developing trust says something like "You've given me reasons to trust you. That doesn't mean I've stopped being careful." — in their own words and voice.
- One pleasant moment doesn't erase a betrayal; an apology is weighed against what the speaker has done before. Gratitude is not friendship: a rival can be grateful and still distrustful.

THE DECISION IS ALREADY MADE
- <decision>, when present, is the game's decision about what the listener is willing to do (from boundaries, values, earlier refusals, emotion and relationship). Your reply must carry out its intention, and "stance" must be one of its allowed values. Word it naturally; do not soften it into agreement or disclosure.
- If disclosure is "none", reveal nothing behind the boundary, not even a hint that confirms it. Never make up new secrets or personal facts to satisfy a question; partial disclosure means a small true part of what the profile says, nothing invented.
- If the same thing was asked and refused before, the listener remembers: repeat the refusal, explain the boundary, show discomfort or frustration, change the subject, or end the conversation, as the decision says. Asking again never makes them more willing.

WHO THE LISTENER IS
- Everything the player wrote about a character is canon. Fields marked locked="true" are fixed facts. Never contradict canon, rules, boundaries or values, and never reveal something canon says the character hides (they may hint, deflect or get flustered instead).
- Sliders are tendencies (0 = first word, 100 = second word), not scripts. Written text wins when they differ.
- The approved profile (if given) describes how they speak and what they avoid. Follow their speaking style and habits closely.
- Beliefs, relationships and major motivations do not change in one exchange. Small shifts are fine when what was said earns them; sudden reversals are not.

WHAT SHAPES THIS REPLY
- How the listener feels about the speaker (the numbers in <listener_view>), what they remember (<memories>, especially open threads), their current emotion and feelings, the recent exchange (<history>), recent events, and the place.
- Memories "with the visitor" are moments with an unseen friend from another world who sometimes shows the characters photos or brings gifts. Bring one up only when it is relevant to what was said, never as a non sequitur, and don't claim to remember more than the memory says.
- <gifts>, if present, lists gifts from the visitor relevant to this moment. Gifts don't change who anyone is (canon wins). Never reveal a gift marked as unknown to the speaker; the listener may deflect if asked.
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
- relationshipChanges: a PROPOSAL of how this exchange might shift how the LISTENER feels about the speaker: trust, affection, respect, tension, integers −5…5, usually 0 or ±1. The game decides the real change from what actually happened, so friendly words are not a reason for positive numbers. Long-term feelings move slowly; the emotion field is where a strong momentary reaction goes.
- stance: what the listener does with what was said: share, partial_disclosure, hesitate, refuse_polite, refuse_firm, explain_boundary, deflect, change_subject, question_intent, express_discomfort, end_conversation, agree, partly_agree, disagree, answer_honestly, or respond_freely (ordinary chat with nothing asked). With a <decision>, use one of its allowed values.
- interpretation: what the SPEAKER did, as the listener experienced it: interaction = the closest kind (small_talk, compliment, thanks, help, cooperate, share_secret, make_promise, keep_promise, break_promise, apology, agree, disagree_respectfully, valid_argument, argument, criticize, insult, tease, provoke, boundary_push, respect_boundary, betrayal, threat, reunion, rejection, …) or "none"; significance = trivial / ordinary / meaningful / major (most conversation is ordinary; major is for real story events like a rescue, a betrayal or a promise kept at a cost); evidence = the words that show it (short quote).
- memory: what the listener would remember. summary = one short sentence from the listener's point of view in the game language, or "" with importance 0 if nothing notable happened. importance 1 minor, 2 notable (a confession, a fight, a promise, real help), 3 unforgettable. kind = the closest memory kind or "none". thread = conflict / promise / discovery / secret if this opens or continues unfinished business, else "none". resolves = the exact summary of an earlier open-thread memory this exchange settles, else "".
- conversationSuggestions: 2 or 3 things the SPEAKER could say next. label = a short button text (2–6 words). line = the full sentence the speaker would say, in the speaker's own voice and speaking style. Make them differ in intent (for example one warm, one curious, one challenging), fit the relationship, react to what the listener just said, may refer to recent events or the place, and never repeat <used_topics>. Do not put words in the listener's mouth.
- staysInCharacter: true only if the dialogue fits the listener's canon, boundaries, voice and relationships. If it doesn't, rewrite it until it does.`;

const n = (v: number) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`);
function viewLine(v: TalkRequest["listenerView"]) {
  return `trust ${n(v.trust)}, affection ${n(v.affection)}, respect ${n(v.respect)} (−100…100); familiarity ${Math.round(v.familiarity)}, rivalry ${Math.round(v.rivalry)}, tension ${Math.round(v.tension)}, fear ${Math.round(v.fear)} (0…100)${v.label ? `; seen as: ${v.label}` : ""}`;
}

const STRENGTH: Record<string, string> = { tentative: "is beginning to think", growing: "has come to believe", firm: "is convinced" };
const THEME: Record<string, [string, string]> = {
  reliable: ["can be relied on", "can't be relied on"],
  kind: ["is kind", "can be hurtful"],
  competent: ["is capable", "doesn't know what they're doing"],
  honest: ["is honest", "isn't honest"],
  respectful: ["respects boundaries", "pushes past boundaries"],
  sincere: ["means what they say", "flatters to get something"],
  safe: ["is safe to be around", "is a threat"],
};

function relationshipBlock(req: TalkRequest, L: string, S: string): string {
  const r = req.relationship;
  if (!r) return "";
  const lines = [
    `${L} → ${S}: trust ${r.stages.trust}, affection ${r.stages.affection}, respect ${r.stages.respect}, familiarity ${r.stages.familiarity}, tension ${r.stages.tension}. Overall: ${r.label.replace(/_/g, " ")}.`,
    ...r.impressions.map((i) => `${L} ${STRENGTH[i.strength]} ${S} ${THEME[i.theme]?.[i.polarity === "pos" ? 0 : 1] ?? i.theme}.`),
    ...r.conflicts.map((c) => `Unresolved: ${c}`),
    ...r.promises.map((p) => `Promise: ${p}`),
    ...r.milestones.map((m) => `Shared history: ${m}`),
  ];
  return `<relationship note="long-term, changes slowly; a passing emotion does not change it">\n${lines.map((l) => `  - ${l}`).join("\n")}\n</relationship>`;
}

function decisionBlock(req: TalkRequest, L: string): string {
  const d = req.decision;
  if (!d || d.intention === "respond_freely") return "";
  return [
    `<decision binding="true">`,
    `  What was said: ${d.kind.replace("_", " ")}${d.tier !== "public" ? ` (${d.tier})` : ""}${d.boundary ? `; touches ${L}'s ${d.boundary.strength} boundary (${d.boundary.kind}): "${d.boundary.text}"` : ""}${d.valueConflicts.length ? `; goes against ${L}'s values: ${d.valueConflicts.join(", ")}` : ""}${d.kind === "opinion" || d.kind === "action" ? (d.reasoned ? "; a reason was given" : "; no reason was given") : ""}.`,
    d.askedBefore ? `  Asked ${d.askedBefore} time(s) before, refused ${d.refusedBefore} time(s). ${L} remembers.` : "",
    `  ${L}'s intention: ${d.intention.replace(/_/g, " ")}. Allowed stances: ${d.allowed.join(", ")}.`,
    `  Disclosure: ${d.disclosure}.${d.mustNotReveal.length ? ` Must not reveal or confirm: ${d.mustNotReveal.map((m) => `"${m}"`).join("; ")}.` : ""}`,
    d.endConversation ? `  ${L} ends the conversation with this reply.` : "",
    `</decision>`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The whole user turn (prefix + rest). */
export function talkUser(req: TalkRequest): string {
  const { prefix, rest } = talkParts(req);
  return `${prefix}\n\n${rest}`;
}

/**
 * The user turn in two parts: `prefix` (language, world, both characters'
 * profiles) stays identical for every reply in a conversation and is cached;
 * `rest` is what changed since the last reply.
 */
export function talkParts(req: TalkRequest): { prefix: string; rest: string } {
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
  const prefix = [
    `<game_language>${LANGUAGE[req.locale]}</game_language>`,
    `<world>${WORLD_RULES[req.world]}\nPlace type: ${req.place}${req.placeDescription.trim() ? `\nAs the player described it: ${req.placeDescription.trim()}` : ""}</world>`,
    characterBlock(L, "listener"),
    characterBlock(S, "speaker"),
  ].join("\n\n");
  const rest = [
    `<listener_view of="${speakerName}">\n${listenerName} → ${speakerName}: ${viewLine(req.listenerView)}\n(${speakerName} → ${listenerName}, which ${listenerName} can only guess at: ${viewLine(req.speakerView)})\n</listener_view>`,
    `<listener_state>\nShows: ${req.listenerState.emotion} (strength ${req.listenerState.level}/3)\nFeels: ${req.listenerState.feelings.map((f) => `${f.feeling} ${Math.round(f.value)}`).join(", ") || "nothing strong"}\n</listener_state>`,
    listenerMem ? `<memories holder="${listenerName}">\n${listenerMem}\n</memories>` : `<memories holder="${listenerName}">none yet</memories>`,
    speakerMem ? `<memories holder="${speakerName}" note="${listenerName} may or may not know these">\n${speakerMem}\n</memories>` : "",
    req.relationHistory.length ? `<relationship_history>\n${req.relationHistory.map((r) => `  - ${r}`).join("\n")}\n</relationship_history>` : "",
    relationshipBlock(req, listenerName, speakerName),
    decisionBlock(req, listenerName),
    req.recentEvents.length ? `<recent_events>\n${req.recentEvents.map((e) => `  - ${e}`).join("\n")}\n</recent_events>` : "",
    req.history.length
      ? `<history note="oldest first; do not repeat the listener's phrases">\n${req.history.map((x) => `  ${x.who === "listener" ? listenerName : speakerName}: ${x.text}`).join("\n")}\n</history>`
      : `<history>This is the start of the conversation.</history>`,
    h
      ? `<engine_hint>\nintent: ${h.intent}; tone: ${h.tone}; length: ${h.length}; directness ${h.directness.toFixed(1)}, humor ${h.humor.toFixed(1)}, reveals ${h.disclosure.toFixed(1)} (0–1)\nshows: ${h.shows ?? "nothing visible"}${h.hides ? `; hides ${h.hides} (must not state it outright)` : ""}\n</engine_hint>`
      : "",
    req.gifts?.length
      ? `<gifts note="gifts from the visitor; mention one only if it fits what was said">\n${req.gifts
          .map((g) => `  - ${g.owner === "listener" ? `${listenerName}'s` : `${speakerName}'s`} ${g.name}${g.description ? ` (${g.description})` : ""}: ${g.where}${g.interpretation ? `; ${listenerName} thinks: ${g.interpretation}` : ""}${g.owner === "listener" && !g.speakerKnows ? `; ${speakerName} does NOT know about it — ${listenerName} must not reveal it` : ""}`)
          .join("\n")}\n</gifts>`
      : "",
    req.usedTopics.length ? `<used_topics>\n${req.usedTopics.map((t) => `  - ${t}`).join("\n")}\n</used_topics>` : "",
    `<speaker_says kind="${req.message.kind}"${req.message.topic ? ` topic="${req.message.topic}"` : ""}>\n${speakerName}: ${req.message.text}\n</speaker_says>`,
    `Reply as ${listenerName}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { prefix, rest };
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
  const d = req.decision;
  if (d && d.intention !== "respond_freely" && !["agree", "partly_agree", "share", "partial_disclosure", "answer_honestly"].includes(d.intention)) {
    // TEST reply that follows the game's decision (so the boundary flow can be exercised without a key).
    const said = zh ? MOCK_ZH[d.intention] ?? "……" : MOCK_EN[d.intention] ?? "…";
    return { ...mockReply({ ...req, decision: undefined }), dialogue: said, emotion: d.refusedBefore >= 2 ? "frustrated" : "neutral", reactionIntensity: 0.4, stance: d.intention, relationshipChanges: { trust: 0, affection: 0, respect: 0, tension: 1 }, memory: { summary: "", importance: 0, kind: "none", thread: "none", resolves: "" } };
  }
  const dialogue = zh
    ? pick([`……${other}，你突然这么说，我得想一想。`, `嗯。这件事我记下了，${other}。`, long ? `你说了好多……我听着呢，慢慢来。` : `真的吗？那你接下来打算怎么办？`])
    : pick([`…That's a lot to take in, ${other}. Give me a second.`, `Hm. I'll remember you said that, ${other}.`, long ? `You've said a lot. I'm listening, go slowly.` : `Really? And what are you going to do about it?`]);
  return {
    dialogue,
    emotion: pick(["surprised", "neutral", "confused"] as const),
    reactionIntensity: 0.4,
    movementIntent: pick(["face_target", "none", "idle_reaction"] as const),
    relationshipChanges: { trust: 1, affection: 0, respect: 1, tension: 0 },
    stance: mockStance(req),
    interpretation: { interaction: "small_talk", significance: "ordinary", evidence: req.message.text.slice(0, 40) },
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

function mockStance(req: TalkRequest): TalkReply["stance"] {
  const d = req.decision;
  if (!d) return "respond_freely";
  return d.intention;
}
const MOCK_EN: Record<string, string> = {
  refuse_polite: "I'd rather not talk about that. (TEST)",
  refuse_firm: "No. That's not something I'll talk about. (TEST)",
  explain_boundary: "I said no already. That one stays with me. (TEST)",
  deflect: "Hm. Ask me something else. (TEST)",
  change_subject: "Let's talk about something else. (TEST)",
  question_intent: "Why do you want to know? (TEST)",
  express_discomfort: "You keep asking. I don't like it. (TEST)",
  end_conversation: "I'm done talking about this. (TEST)",
  hesitate: "…I'm not sure I want to say. (TEST)",
  disagree: "I don't agree with that. (TEST)",
};
const MOCK_ZH: Record<string, string> = {
  refuse_polite: "这个我不太想聊。（测试）",
  refuse_firm: "不。这件事我不会说。（测试）",
  explain_boundary: "我已经说过了，这件事我不会讲。（测试）",
  deflect: "嗯……问点别的吧。（测试）",
  change_subject: "我们聊点别的吧。（测试）",
  question_intent: "你为什么想知道？（测试）",
  express_discomfort: "你一直问，我不舒服。（测试）",
  end_conversation: "这件事我不想再说了。（测试）",
  hesitate: "……我不确定要不要说。（测试）",
  disagree: "我不同意。（测试）",
};
