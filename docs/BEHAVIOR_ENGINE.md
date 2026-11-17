# Behavior engine

Characters decide how to react from **personality + feelings + relationship + memories + context**, never from a single slider. Code: `src/lib/mind/`. Tests: `tests/mind.test.ts`.

## How a decision is made

```
event (e.g. "Mira is approached by Tobi")
  1. Context      personality (sliders + written profile), feelings, Mira→Tobi relationship,
                  memories with Tobi, place, distance, goals, is Mira free to move?
  2. First impression   the event raises feelings (TRIGGER_DEFS.appraisal)
  3. Candidates   every action that makes sense for this kind of event
  4. Hard limits  removed BEFORE any dice: locked canon / rules, player is steering them,
                  busy mid-sentence, target unreachable, no room to step back, cooldown
  5. Score        base + Σ weight × features + the character's own preference
  6. Choose       softmax(score / temperature) × repetition penalty, seeded random
  7. Output       expression (what SHOWS, may be hidden), movement, pause, dialogue style
  8. Apply        feelings, both directions of the relationship, memory, decision record
```

| Responsibility | Where |
| --- | --- |
| Character Profile Manager | `profile.ts` (sliders → 0–1 factors, written-profile cues, canon limits, preferences) |
| Emotion State Manager | `feelings.ts` (+ `withEmotion`/`fadeEmotion` in `src/lib/emotion/emotions.ts`) |
| Relationship Manager | `relations.ts` (directional `A>B`, seeded from the written relationships text) |
| Memory Manager | `memory.ts` (merges repeats, softens contradictions) |
| Context Evaluator, Candidates, Scoring, Selection, Action Validator | `decide.ts` |
| All tunable numbers | `catalog.ts` |
| Movement & animation | `decide.ts › movementFor` → existing validated stage actions (`src/lib/stage`) |
| Dialogue integration | `speech.ts` (built-in lines `behave.*` in the locale files, AI brief) |
| Story beat → event | `beats.ts` |
| Sample cast + 10 scenarios | `scenarios.ts` |

## Data (stored in the save's `story`)

```ts
// Personality: Character.traits (10 sliders, 0–100) + written fields. Never changed by the engine.

// Feelings, per character (several at once), 0–100:
story.characters[id].feelings = { anxiety: 62, embarrassment: 30, affection: 75 }
story.characters[id].emotion  = "embarrassed"   // what SHOWS (drives the pixel effect)
story.characters[id].emotionLevel = 1           // 1 subtle · 2 moderate · 3 strong

// Relationships, directional ("from>to"):
story.relations["sample-tobi>sample-wren"] = { trust: 0, affection: 0, respect: 15, familiarity: 85, rivalry: 65, tension: 55, fear: 55, label: "rival" }
story.relations["sample-wren>sample-tobi"] = { trust: -55, affection: -50, respect: 15, familiarity: 100, rivalry: 65, tension: 95, fear: 0, label: "enemy" }

// Memories (existing list, now with kind + count):
{ kind: "provoked", withId: "sample-tobi", importance: 3, count: 5, turn: 14, ... }

// Recent decisions (repetition penalty, cooldowns):
story.decisions = [{ turn, actorId, otherId, trigger, action, at }]
```

## Same event, different reactions (400 seeded runs each)

| Scenario | Most common reactions |
| --- | --- |
| 1 Introvert (Mira) approached by a stranger | step back 48%, answer cautiously 37%, stay still 8% |
| 2 Same Mira approached by her best friend | greet 78%, approach 9%, face them 6% |
| 3 Extrovert (Tobi) approached by the rival he fears | challenge 21%, face them 18%, cautious 15%, greet 13% |
| 4 Tobi criticized unexpectedly | defensive 37%, frustration 15%, then many smaller options |
| 5 Proud Wren complimented by her enemy | face them 25%, ask a question 19%, defensive 18% (thanks: 1%) |
| 6 Rivals forced to cooperate | challenge 27%, face them 23%, cautious 20% |
| 7 Calm Mira provoked repeatedly | anger builds turn by turn; frustration/defensive odds rise |
| 8 Mira meets someone who betrayed her | cautious 62%, step back 17%, avoid 12%, greet ~0% |
| 9 Sol: Mira's exact sliders, grew up on a busy ferry | cautious 61%, step back only 4% (Mira: 48%) |
| 10 Wren hides strong affection for Mira | step closer 57%, stay silent 14%, change subject 11%; hearts never shown, "show affection" blocked by her locked canon, a small blush/tell instead |

## Tuning

Everything is in `src/lib/mind/catalog.ts`:

- `ACTION_DEFS[action].terms`: `{ f: "p.extro", w: 0.9 }` adds 0.9 × extroversion. A list multiplies: `{ f: ["p.intro", "r.unfamiliar"], w: 1.3 }` only counts for an introvert facing a stranger. Feature names are listed at the top of the file.
- `base`: how likely the action is with nothing else going on.
- `TRIGGER_DEFS[trigger].appraisal`: how much each feeling rises when the event happens.
- `TEMPERATURE`: lower = more predictable, higher = more varied (impulsive characters get more).
- `REPEAT_PENALTY`, `cooldown`: anti-repetition.
- `EXPRESSION`: how much of a feeling shows, and the subtle / moderate / strong thresholds.
- `CANON_RULES` in `profile.ts`: phrases in rules/canon that block actions (e.g. "never admits her feelings").
- `RELATION_SEEDS` in `relations.ts`: words in the relationships text that set starting values.

After changing a number, run `npm test` (the scenario tests check tendencies, not exact rolls) and use the Behavior Debug Panel's "Odds over 100 runs".

## Debug panel

Settings → *Behavior debug panel*. Only offered in `npm run dev`, or in a deployed build after opening `/play?dev=1` once (`?dev=0` hides it again). It shows personality factors, feelings before/after, both relationship directions, memories, every candidate's score and chance, rejected actions and why, the chosen action with its reasons, expression, movement and dialogue style. Scenarios 1–10 can be loaded onto the real stage with sample characters; nothing is saved to the player's story. A fixed seed reproduces a result from the same state.

## Still rule-based (hardcoded)

- Which story event happens and how the ACTOR reacts is still the older story engine (`src/lib/story`); the behavior engine decides the OTHER character's response, the listener's response in Talk, and reactions to being walked up to.
- The actor's own movement in a beat still uses `src/lib/stage/behavior.ts` (personality + emotion rules).
- Idle animations (look around, hop, sigh) are the existing personality rules.
- Written-profile reading is keyword-based (EN + 中文), not language understanding.
- Story beat → event mapping (`beats.ts`) is a fixed table.
