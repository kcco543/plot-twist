# Relationships, boundaries and character agency

Code: `src/lib/relationships/`. Every tunable number: `src/lib/relationships/config.ts`.

## Three layers that never mix

| Layer | What | Where | Changes |
|---|---|---|---|
| Long-term relationship | trust, affection, respect, familiarity, rivalry, tension, fear, dependence (A→B ≠ B→A) | `story.relations`, visitor: `story.player` | Only through `recordInteraction()` (progression.ts) |
| Impressions | "Tobi pushes past my boundaries", each backed by evidence | `story.progress[from>to].impressions` | From the kind of interaction, slowly |
| Emotions | happiness, gratitude, anger… right now | `story.characters[id].feelings` | Can be big; fade; never write the long-term numbers |

## How a change is validated (`recordInteraction`)

1. The moment is classified as an **interaction kind** (`interactions.ts`): small talk, compliment, help, betrayal… The AI's reading is a proposal; the game's word classifier (`classify.ts`) must support kinds like `rescue`, `betrayal` or `share_secret`.
2. **Significance** (trivial, ordinary, meaningful, major). Kinds in `ORDINARY_MAX` never go above ordinary; only `MAJOR_OK` kinds can be major.
3. Base effect × significance, then: repetition in a 10-turn window, lifetime diminishing returns per kind, same gift/photo again, flattery detection, "higher is harder" level damping, open conflicts slowing trust/affection, rivalry slowing warmth. Repetition only dampens the good side.
4. **Caps** per axis and per interaction by significance (ordinary: 2 per axis, 3 total).
5. **Stage doors**: a value can't climb more than `ceilingSlack` past a stage whose milestone requirements are missing.
6. Commit atomically (any error leaves the story unchanged), then milestones, conflict repair, impressions, stage updates (hysteresis: enter above `enter`, leave below `exit`), and a `ChangeRecord` with proposed vs accepted values and reasons.

AI numbers are used only when they are *colder* than the rule (`blendProposal`): an AI can make a moment hurt more, never make it warmer than the rule allows.

## Stages and labels

Each axis has a ladder in `config.ts` (`stages`). Higher stages need milestones (`need`, `distinct`) such as `reliable_behavior`, `promise_kept`, `helped_in_difficulty`, `voluntary_secret`, `shared_experience`, `resolved_disagreement`, `respected_boundaries`. Labels (stranger, acquaintance, friend, close friend, rival, respected rival, enemy, wary) are read from several stages together (`bondLabel`), so trust alone never makes a friend and respect alone never makes affection.

## Boundaries and the decision before every reply (`boundaries.ts`)

Character Studio has **hard** and **soft** boundaries (secret, topic, principle) with trigger words in any language. Locked canon lines that say "never…/secret…/从不…" also count as hard.

`decideRequest()` runs before any dialogue, built-in or AI:

1. Identify the request and its sensitivity tier (public, casual, sensitive, private, locked).
2. Hard boundaries: always refused. Escalation by how often it was refused before: refuse → refuse firmly / explain → change subject / discomfort → end the conversation.
3. Values: an opinion or request against the character's values is disagreed with at *any* trust.
4. Memories and earlier refusals: asking again after a refusal never raises willingness (pressure only lowers it) and counts as a boundary push.
5. Emotional state.
6. Relationship: trust adds a little willingness for ordinary private things, capped by tier (`tierMax`). Soft boundaries open only after real trust milestones, never from a number or from being asked again.
7. Select an intention (`INTENTIONS`). The "dice" are a hash of the state, so re-asking never rerolls.
8. Dialogue: the AI must return a `stance` from `decision.allowed`; a reply that shares what the game decided to keep, picks another stance or overclaims trust is rejected and replaced by a built-in line (`rel.say.<intention>`).

Trust is not obedience: there is no rule of the form "trust > X means agree". A reasonable argument earns agreement and respect from a rival without adding affection or trust.

## Developer tools

- **Relationship Inspector** (Settings, developers only; dev builds or `?dev=1`): one direction at a time, values and stages, what the next stage needs, impressions, milestones, conflicts/promises/refused requests, memories and every validated change with its reasons. "Run scenarios" and "20-interaction simulation" replay `scenarios.ts` with a fixed seed.
- Tests: `tests/relationships.test.ts` runs every scenario on several seeds in both languages, the 20-interaction simulation, repeated refusals and the AI rejection rules.

## Saves

Only additive, optional fields (`story.progress`, `Character.boundaries`, `Relation.dependence`). Existing worlds load unchanged; their stages are read from their current values the first time ("grandfathered"). Changes are written only to the active world's save.
