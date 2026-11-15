# AI conversations

How a character's reply in a walk-and-talk is written by Claude and checked by the game.

## Flow

1. The player picks a suggested topic, an AI suggestion, or types a message (Ask Something Else).
2. The speaker's line plays in their bubble. At the same moment the game builds a request (`buildTalkRequest`, `src/lib/talk/ai/request.ts`) and posts it to `/api/ai/talk`. Further clicks are ignored until the reply is in (and the server refuses a second request from the same visitor while one is running).
3. The server (`src/app/api/ai/talk/route.ts`) validates the request, applies usage limits, and asks Claude for a structured reply (`TalkReplySchema`). It checks the reply (`replyProblem`, `src/lib/talk/ai/checks.ts`); a reply that breaks character, uses the wrong language, repeats the character's own recent line or fails the model's own canon check is retried once with the reason, then rejected.
4. In the browser the reply is parsed against the schema again, then the game engine validates it (`validateReply`, `src/lib/talk/ai/apply.ts`) and applies it in this order: dialogue in the typewriter bubble → emotion effect → one movement → relationship change → memory → Story Log → next suggestions.
5. If anything fails, nothing is applied. For a suggested topic the built-in reaction is shown instead, with a visible note. For typed messages and AI suggestions the panel says what failed and offers **Try again**.

## What the AI is told

Only what this reply needs: both characters' written profiles (exactly as written, locked fields marked), slider values, the approved behavior profile if any, how the listener feels about the speaker (trust, affection, respect, familiarity, rivalry, tension, fear) and the reverse, the listener's shown emotion and strongest inner feelings, the last 10 lines between the two, up to 8 memories (open threads first, then the strongest with this person, then a couple of big ones with others), the last relationship shifts, a few recent Story Log lines, the place, the behavior engine's read of how the listener tends to react (as a guide), and topics already used in this conversation.

## Validation (the game decides)

| Proposal | Rule |
| --- | --- |
| emotion | Only the 11 game emotions. Strength from intensity, capped for reserved characters. Canon masks win (Wren "never admits her feelings": affectionate becomes a mild embarrassed). An angry character doesn't flip to beaming in one line. |
| movement | Only none / approach / retreat / face_target / idle_reaction. "Never backs down" bans retreat. Retreating while warming up, or approaching someone feared or while tension rises, becomes face_target. The stage's pathfinding and collision handle walls and other characters; a character already walking is never given a second walk. |
| relationship | trust / affection / respect / tension only, ±5 each, at most 10 in total. Strong feelings (±40) move at most 2 against their direction unless the moment is unforgettable (importance 3). Every value stays in its range. |
| memory | Saved only when it matters. A near-identical memory is strengthened instead of duplicated; a contradicting recent memory fades. Open threads (conflict, promise, discovery, secret) are kept and marked resolved when a later exchange settles them. |

## Memory

Saved with the game (browser storage): per character `memories` (with `note`, `thread`, `resolved`, `source`), per pair `story.talk` (last 16 lines), per direction `story.relationLog` (last 6 shifts). The player can correct, resolve or forget any memory in Play Mode → character → Memories.

## Language

Replies, memory summaries and suggestions are always in the current game language. A message in another language is kept exactly as typed in the log, and the character still answers in the game language. Names are never translated.

## Cost and safety

Key only on the server (`ANTHROPIC_API_KEY`). Each reply is at most two calls with `effort: low`, a 4000-token cap and a 22 s timeout. Per-visitor limits (12/minute, 300/day) and a server-wide daily cap (1500) are configurable in `.env.local`. Message length 200 characters; request body 48 KB. Real replies are tagged **AI**; the development-only test double (`AI_TALK_MOCK=1`) is tagged **TEST** and is never available in production.
