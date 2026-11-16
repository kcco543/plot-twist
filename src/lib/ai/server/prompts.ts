import "server-only";
import type { AnalyzeRequest, CharacterBrief, TurnRequest } from "../contracts";

export const LANGUAGE: Record<string, string> = { en: "English", "zh-CN": "Simplified Chinese" };

export const TRAIT_POLES: Record<string, [string, string]> = {
  extroversion: ["introverted", "extroverted"],
  impulsiveness: ["cautious", "impulsive"],
  expressiveness: ["reserved", "expressive"],
  trust: ["distrustful", "trusting"],
  idealism: ["pragmatic", "idealistic"],
  dependence: ["independent", "dependent"],
  confrontation: ["conflict-avoidant", "confrontational"],
  playfulness: ["serious", "playful"],
  empathy: ["self-centered", "empathetic"],
  rebelliousness: ["rule-following", "rebellious"],
};

export const WORLD_RULES: Record<string, string> = {
  "western-fantasy": "Western fantasy: mossy villages, crooked castles, prophecies, low magic that is common but unreliable.",
  modern: "Modern day: cafés, late trains, phones and group chats. No magic.",
  "ancient-china": "Ancient China: courtyards, roadside inns, wandering swordsfolk, honor debts. Grounded wuxia flavor, no modern technology.",
  otherworld: "Otherworld: floating islands, glowing plants, small strange creatures, and physics that occasionally changes its mind. Whimsical, never grim.",
};

/** Player-written fields, quoted exactly. Empty fields are skipped. */
export function characterBlock(c: CharacterBrief, label: string) {
  const lines = [`<${label} id="${c.id}">`];
  for (const [k, v] of Object.entries(c.fields)) {
    if (!v || !v.trim()) continue;
    const locked = c.lockedFields.includes(k as never) ? " locked=\"true\"" : "";
    lines.push(`  <${k}${locked}>${v.trim()}</${k}>`);
  }
  if (c.identity) {
    lines.push(`  <gender_and_pronouns note="chosen by the player: refer to this character with these pronouns (in Chinese: she/her = 她, he/him = 他, they/them or custom = TA or the name); never infer personality, interests, abilities or behavior from gender">gender: ${c.identity.gender}; pronouns: ${c.identity.pronouns}</gender_and_pronouns>`);
  } else {
    lines.push(`  <gender_and_pronouns note="not specified by the player: don't assume a gender; use the character's name, or singular they (Chinese: the name or TA)">not specified</gender_and_pronouns>`);
  }
  const traits = Object.entries(c.traits);
  if (traits.length) {
    lines.push("  <sliders note=\"0 = first word, 100 = second word; tendencies, not rules\">");
    for (const [k, v] of traits) lines.push(`    ${TRAIT_POLES[k]?.[0]} ↔ ${TRAIT_POLES[k]?.[1]}: ${v}`);
    lines.push("  </sliders>");
  }
  if (c.boundaries?.length) {
    lines.push(`  <boundaries note="hard = never crossed in play; soft = avoided, may be reconsidered only through real shared experience">`);
    for (const b of c.boundaries) lines.push(`    ${b.strength} ${b.kind}: ${b.text}`);
    lines.push(`  </boundaries>`);
  }
  if (c.profile) {
    lines.push(`  <approved_profile>`);
    lines.push(`    summary: ${c.profile.summary}`);
    lines.push(`    speech: ${c.profile.speech.register} (${c.profile.speech.length}); tics: ${c.profile.speech.tics.join("; ") || "none"}; avoids: ${c.profile.speech.avoids.join("; ") || "nothing specific"}`);
    if (c.profile.boundaries.length) lines.push(`    boundaries: ${c.profile.boundaries.join("; ")}`);
    for (const p of c.profile.emotionalPatterns.slice(0, 4)) lines.push(`    when ${p.trigger}: ${p.reaction} (but ${p.variation})`);
    lines.push(`  </approved_profile>`);
  }
  lines.push(`</${label}>`);
  return lines.join("\n");
}

export const ANALYSIS_SYSTEM = `You analyze original characters for PLOT TWIST!, a cozy pixel-art storytelling game, and return a structured behavioral profile the game uses to drive dialogue and events.

How to read the input:
- The player's written profile is canon. Interpret it; never rewrite, soften or contradict it. Fields marked locked="true" are fixed facts: when you state or quote one, use the player's exact words in their original language, never a translation or paraphrase.
- <gender_and_pronouns> only tells you how to refer to the character. Never infer personality, interests, abilities, emotional style or behavior from gender. If it is not specified, don't assume one.
- Sliders (0–100 between two poles) are tendencies, not rules. Use them to fill gaps and set intensity.
- When the written profile and a slider disagree, do not pick a winner. Report it in "conflicts" with a short, friendly note on how both could be true or what the player might adjust.
- Use background, goals, fears, values, relationships, memories and current mood as evidence.

What to write:
- summary: 2–3 sentences that are specific to THIS character, not a generic type.
- coreTraits: 3–6 items; each has evidence pointing at what the player wrote or set.
- speech: register, typical length, verbal habits, things they avoid saying, and one short sample line in their voice.
- emotionalPatterns: 3–5 items. Every item needs a "variation" describing when the same trait shows up differently (with someone they trust, under stress, when proud...). Avoid stereotypes.
- boundaries: restate the player's rules and values as hard limits. Do not invent new limits.
- reactionTendencies: 0–100 for each reaction (confront, deflect, withdraw, comfort, joke, investigate, act, cooperate).
- dialogueApproaches: the 2–4 that fit best.
- storyHooks: 2–4 situations that would create interesting, character-true drama.

Write all your own text in the requested language. When quoting the player's words, quote them exactly in the language they were written in. Never translate or change names.`;

export function analysisUser(req: AnalyzeRequest) {
  const parts = [
    `Language for your text: ${LANGUAGE[req.locale]}`,
    req.world ? `World: ${WORLD_RULES[req.world]}` : "World: not chosen yet.",
    characterBlock(req.character, "character"),
    req.cast.length ? `<cast>\n${req.cast.map((c) => `  ${c.name || "(unnamed)"}: ${c.relationships || "(no relationships written)"}`).join("\n")}\n</cast>` : "",
    `Current mood: ${req.mood}`,
    req.memories.length
      ? `<memories>\n${req.memories.map((m) => `  ${m.eventType}${m.withName ? ` with ${m.withName}` : ""} (importance ${m.importance})${m.note ? `: ${m.note}` : ""}`).join("\n")}\n</memories>`
      : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

export const TURN_SYSTEM = `You write one short story beat for PLOT TWIST!, a cozy, slightly chaotic pixel-art storytelling game. The game's rules have ALREADY decided what happens: the event, who is involved, the character's reaction, the mood change and whether a bond got closer or further. Your only job is to put that outcome into words.

Rules:
- Follow the given outcome exactly. Do not add new events, injuries, deaths, new characters, romance, or changes to relationships beyond the bond change given.
- Never contradict anything the player wrote, and treat fields marked locked="true" as fixed facts. Never break a character's boundaries.
- Speak in each character's own voice: use their speech style, the dialogue approach given, and their current mood. The same trait can show differently depending on the situation; avoid stereotypes and generic lines.
- Do not repeat or closely paraphrase any of the recent lines.
- 1 to 4 lines. Narrator lines set the scene (third person, present tense). Character lines are things they say aloud. Keep each line under 200 characters (under 80 Chinese characters).
- speaker must be one of the allowed speaker ids. Never write names in the speaker field; the game adds names.
- memoryNote: one short sentence the character would remember about this moment (or an empty string if nothing notable happened).
- Write in the requested language. Keep character names exactly as written. Quote player-written phrases exactly if you quote them.
- Tone: warm, funny, lightly mysterious. Suitable for all ages.
- If a <behavior_plan> is given, the game engine has ALSO decided how each listed character reacts (their intention, what shows on their face, how they move). Write that character's line so it carries out that intention in the given style: length (terse = a few words, short = one sentence, full = one or two sentences; silent = no line from them), tone, directness, humor, formality and how much they reveal. If hesitant, let them pause or trail off. If a feeling is hidden, they must NOT state it outright; at most a narrator line may hint at it. Never describe a movement other than the one given, and never invent new actions, touches or state changes: movement and state are controlled by the game.`;

const BEAT_HELP: Record<string, string> = {
  talk: "The selected character talks about the given topic (to the other character if one is given, otherwise to the player).",
  observe: "The narrator describes what the player notices about the character right now (appearance, habits, mood). No dialogue needed.",
  wait: "A quiet moment passes in this place; small ambient details. Keep it low-key.",
  confide: "The other character opens up to the actor about a fear or something from their past.",
  argument: "The actor and the other character disagree about the actor's goals or values.",
  misunderstanding: "The actor overhears or misreads something the other character said.",
  kindness: "The other character does something small and kind for the actor.",
  tease: "The other character teases the actor.",
  askHelp: "The actor needs help with their goal and it involves the other character.",
  rivalry: "The actor and the other character both want the same thing.",
  rumor: "The actor hears a rumor about the other character.",
  temptation: "The actor gets a chance to bend one of their own rules or values. They do NOT break it; the reaction shows how they handle the pull.",
  goalStep: "Something moves the actor's goal forward or sets it back (see outcome).",
  fearTrigger: "Something in this place brushes against the actor's fear.",
  memoryEcho: "Something reminds the actor of an earlier memory (given).",
  worldQuirk: "Something only this world could produce happens nearby.",
  discovery: "The actor finds something in this place.",
  quietMoment: "A quiet moment shows one of the actor's habits or small details.",
};

export function turnUser(req: TurnRequest) {
  const b = req.beat;
  const allowed = ["narrator", req.actor.id, ...(req.other ? [req.other.id] : [])];
  const what = b.kind === "event" ? BEAT_HELP[b.type] ?? b.type : BEAT_HELP[b.kind];
  const outcome = [
    `What happens: ${what}`,
    b.topic ? `Topic: ${b.topic}` : "",
    b.reaction ? `Actor's reaction (decided by the game): ${b.reaction}` : "",
    `Actor's dialogue approach: ${b.approach}`,
    `Actor's mood: ${b.moodBefore} -> ${b.moodAfter}`,
    b.outcome ? `Goal outcome: ${b.outcome}` : "",
    b.bondChange && req.other ? `Bond between them: ${b.bondChange}` : "",
    req.bond && req.other ? `Bond so far: affinity ${req.bond.affinity}, trust ${req.bond.trust} (−100 to 100)` : "",
    b.recalled ? `Memory being recalled: ${b.recalled.eventType}${b.recalled.withName ? ` with ${b.recalled.withName}` : ""}${b.recalled.note ? ` — ${b.recalled.note}` : ""}` : "",
  ].filter(Boolean);
  return [
    `Language: ${LANGUAGE[req.locale]}`,
    `World: ${WORLD_RULES[req.world]}`,
    `Place type: ${req.place}${req.placeDescription.trim() ? `\nPlace as the player described it: ${req.placeDescription.trim()}` : ""}`,
    characterBlock(req.actor, "actor"),
    req.other ? characterBlock(req.other, "other") : "",
    req.memories.length ? `<actor_memories>\n${req.memories.map((m) => `  ${m.eventType}${m.withName ? ` with ${m.withName}` : ""}${m.note ? `: ${m.note}` : ""}`).join("\n")}\n</actor_memories>` : "",
    `<outcome>\n${outcome.join("\n")}\n</outcome>`,
    req.recentLines.length ? `<recent_lines do_not_repeat="true">\n${req.recentLines.map((l) => `  ${l}`).join("\n")}\n</recent_lines>` : "",
    req.behaviors?.length ? behaviorPlan(req) : "",
    `Allowed speaker ids: ${allowed.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const MOVE_TEXT: Record<string, string> = {
  toward: "walks up to them",
  closer: "steps a little closer",
  away: "backs away",
  step_back: "takes a step or two back",
  face: "turns to face them",
  still: "stays where they are",
  hop: "gives a small hop",
  stomp: "stomps once",
  glance: "glances around",
  sigh: "sighs",
  shift: "shifts their weight",
  turn_away: "turns away",
};

function behaviorPlan(req: TurnRequest) {
  const lines = (req.behaviors ?? []).map((b) => {
    const s = b.style;
    return [
      `  <reaction character="${b.characterId}" to="${b.trigger}"${b.causedBy ? ` by="${b.causedBy}"` : ""}>`,
      `    intention: ${b.intent}${b.speaks ? "" : " (no spoken line)"}`,
      `    movement (already happening on screen): ${MOVE_TEXT[b.movement] ?? b.movement}`,
      `    style: ${s.length}, ${s.tone} tone, directness ${s.directness}, humor ${s.humor}, formality ${s.formality}, reveals ${s.disclosure}${s.hesitant ? ", hesitates first" : ""}${s.useName ? ", may use the listener's name" : ""}`,
      `    feels: ${b.feelings.map((f) => `${f.feeling} ${f.value}`).join(", ") || "nothing strong"}`,
      `    shows: ${b.shows ? `${b.shows.emotion} (strength ${b.shows.level}/3)` : "nothing visible"}${b.hiddenFeeling ? `; hides ${b.hiddenFeeling}` : ""}`,
      `  </reaction>`,
    ].join("\n");
  });
  return `<behavior_plan decided_by_game="true">\n${lines.join("\n")}\n</behavior_plan>`;
}
