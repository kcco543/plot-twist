import "server-only";
/**
 * Prompt for gift reactions (/api/ai/gift-reaction): the player ("the
 * visitor") gives one character a gift they made. Claude voices the reaction
 * and proposes what the character does with it; the game decides.
 */
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { GiftReactionReply, GiftReactionRequest } from "@/lib/gifts/contract";
import { characterBlock, LANGUAGE, WORLD_RULES } from "./prompts";

export const GIFT_SYSTEM = `You voice ONE character in PLOT TWIST!, a cozy, slightly chaotic pixel-art storytelling game. The visitor ("访客" in Chinese) — an unseen friend from another world who sometimes shows the characters photos and brings gifts — has just handed your character a gift the visitor made themselves. React as the character would, out loud, inside the game world. You are not an assistant or narrator. Never mention AI, games, players, prompts or rules.

THE GIFT
- You get its name, the visitor's description and, if drawn, a tiny 32×32 pixel picture of it. Only use what the name, description and picture say. Don't invent extra properties. If it's unclear what it is, the character may guess, misread it in a way that fits them, or ask.
- interpretation: what the character thinks it is or means, from their point of view, in one sentence (e.g. "A glowing cookie, probably meant to keep me awake while I draw maps.").

WHO THE CHARACTER IS
- Everything the player wrote about the character is canon; locked="true" fields are fixed facts. Never contradict canon, rules, boundaries or values. Sliders are tendencies. The approved profile (if given) describes how they speak.
- Their interests, values, fears, pride, past and memories decide how they take it. A gift that touches a fear may upset them; one that fits an interest may delight them; a proud or guarded character may play it down even if pleased.

THE DECISION (not everyone loves every gift)
- decision: accept, refuse, or indifferent (they take it but don't much care). Refuse when it fits: it clashes with their values or rules, they distrust the visitor, it feels like a bribe, it's something they fear, or they just don't accept gifts. Most ordinary gifts from someone they like are accepted, but vary it honestly.
- keep: where they'd keep it if they take it. displayed (put somewhere everyone can see), carried (keep it on them), private (in their own things), hidden (tucked away where nobody will find it — embarrassment, secrecy, or treasuring it in private), stored (put away and forgotten). Reserved or secretive characters rarely display things; proud or open ones might. <free_display_spots> says how many visible spots are free (0 = none). keepReason: a few words why.
- <earlier_gifts> are earlier gifts from the visitor and where they ended up: a repeated or similar gift may get a different reaction (amused, tired of it, touched that they remembered). If <gift repeat="true">, they already got this same gift once.

THE REACTION
- How they feel about the visitor (<player_bond>) changes the tone: a stranger is polite or wary; a close friend is open, teasing or touched; someone who distrusts the visitor may be suspicious.
- dialogue: only the spoken words; no name prefix, quotes or *actions*. 1–3 sentences in their voice, at most 60 English words or 90 Chinese characters. Mention something specific about the gift. Avoid generic thanks ("Thank you so much, I love it!").
- followUpQuestion: a short question to the visitor, or "" if they wouldn't ask.
- emotion + intensity (0–1, usually 0.2–0.6). movementIntent: none, lean_in, step_back, hop, look_around, fidget; must agree with the emotion.
- relationshipChanges: trust, affection toward the visitor, integers −3…3, usually 0–2; negative only if the gift genuinely offends or worries them.
- memory: summary = one sentence from the character's point of view about getting this gift and what was said (e.g. "The visitor gave me a glowing cookie they drew themselves; I pretended not to be pleased."). significance = why it matters to them, or "". importance 1 minor, 2 notable, 3 unforgettable.
- staysInCharacter: true only if it fits their canon, boundaries and voice. Suitable for all ages.

LANGUAGE POLICY
- Write dialogue, interpretation, keepReason, question and memory in the game language in <game_language>, always. Keep names and the gift's name exactly as written.`;

const n = (v: number) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`);

export function giftText(req: GiftReactionRequest): string {
  const name = req.character.fields.name?.trim() || "(unnamed)";
  const p = req.player;
  const feel = p.affection >= 40 && p.trust >= 25 ? "close" : p.affection <= -25 || p.trust <= -25 ? "wary of them" : p.familiarity < 10 ? "barely knows them" : "friendly acquaintance";
  const mem = req.memories.map((m) => `  - ${m.summary}${m.withName ? ` (with ${m.withName})` : ""}; importance ${m.importance}; ${m.turnsAgo} turns ago`).join("\n");
  return [
    `<game_language>${LANGUAGE[req.locale]}</game_language>`,
    `<world>${WORLD_RULES[req.world]}\nPlace type: ${req.place}${req.placeDescription.trim() ? `\nAs the player described it: ${req.placeDescription.trim()}` : ""}</world>`,
    characterBlock(req.character, "character"),
    `<player_bond note="how ${name} feels about the visitor">\ntrust ${n(p.trust)}, affection ${n(p.affection)} (−100…100); familiarity ${Math.round(p.familiarity)} (0…100); photos shared ${p.photosShared}, gifts given ${p.giftsGiven}. In short: ${feel}.\n</player_bond>`,
    `<character_state>\nShows: ${req.state.emotion} (strength ${req.state.level}/3)\nFeels: ${req.state.feelings.map((f) => `${f.feeling} ${Math.round(f.value)}`).join(", ") || "nothing strong"}\n</character_state>`,
    mem ? `<memories holder="${name}">\n${mem}\n</memories>` : `<memories holder="${name}">none yet</memories>`,
    req.earlierGifts.length ? `<earlier_gifts>\n${req.earlierGifts.map((g) => `  - ${g.name}: ${g.display}; ${g.interpretation}`).join("\n")}\n</earlier_gifts>` : "",
    `<free_display_spots>${req.freeDisplaySpots}</free_display_spots>`,
    `<gift repeat="${req.gift.repeat}">\nname: ${req.gift.name}\ndescription: ${req.gift.description.trim() || "(none)"}\npicture: ${req.gift.image ? "attached (32×32 pixel art drawn by the visitor)" : "none"}\n</gift>`,
    `React as ${name}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function giftContent(req: GiftReactionRequest, extra = ""): string | BetaContentBlockParam[] {
  const text = giftText(req) + extra;
  if (!req.gift.image) return text;
  return [
    { type: "image", source: { type: "base64", media_type: "image/png", data: req.gift.image } },
    { type: "text", text },
  ];
}

/** AI_TALK_MOCK=1 (development only): a canned TEST reaction, labelled TEST in the game. */
export function mockGiftReply(req: GiftReactionRequest): GiftReactionReply {
  const zh = req.locale === "zh-CN";
  const g = req.gift.name;
  const refuse = /refuse|拒绝/i.test(req.gift.description);
  const hide = /secret|秘密/i.test(req.gift.description);
  return {
    decision: refuse ? "refuse" : "accept",
    interpretation: zh ? `${g}……大概是特意为我做的。` : `${g}… probably made just for me.`,
    dialogue: refuse ? (zh ? `${g}？我不能收下。` : `${g}? I can't take this.`) : zh ? `${g}？给我的？……我会好好收着。` : `${g}? For me? …I'll take good care of it.`,
    emotion: refuse ? "confused" : "happy",
    intensity: 0.45,
    movementIntent: refuse ? "step_back" : "hop",
    keep: hide ? "hidden" : req.freeDisplaySpots > 0 ? "displayed" : "carried",
    keepReason: zh ? "测试" : "test",
    relationshipChanges: { trust: 0, affection: refuse ? 0 : 1 },
    memory: { summary: zh ? `访客送了我${g}。` : `The visitor gave me ${g}.`, significance: "", importance: 2 },
    followUpQuestion: refuse ? "" : zh ? "这是你自己画的吗？" : "Did you draw this yourself?",
    staysInCharacter: true,
  };
}
