# AI costs: audit, changes and controls

This is the record of the Anthropic API cost audit (November 2026): every place
the game calls Claude, what changed, which model each feature uses, and how the
limits and modes work. Prices are Anthropic's list prices per million tokens at
the time of writing; update `PRICES` in `src/lib/ai/server/usage.ts` when they change.

## 1. Every place the app called Anthropic (before)

All Claude requests go through one function, `structuredCall()` in
`src/lib/ai/server/claude.ts`, from six server routes. Before this change every
one of them used **Claude Opus 5.5** ($4 input / $20 output per million tokens),
with no prompt caching.

| Route | Triggered by | Before |
| --- | --- | --- |
| `/api/ai/talk` | Player sends a topic, AI suggestion or typed message in a walk-and-talk | Opus 5.5, effort low, max 4,000 tokens, one retry if the reply broke character |
| `/api/ai/turn` | Player presses **Talk / Observe / Wait / Twist!** (or Z/X/C/V) with AI story writing on | Opus 5.5, effort low, max 8,000 tokens, no rate limit |
| `/api/ai/analyze` | **Run AI analysis** button in the Character Studio | Opus 5.5, effort medium, max 16,000 tokens, no rate limit |
| `/api/ai/refine` | **Refine This Analysis** button | Opus 5.5, effort medium, max 16,000 tokens, no rate limit |
| `/api/ai/photo` | Player confirms **Send** on a photo | Opus 5.5, effort low, max 4,000 tokens, one retry |
| `/api/ai/gift-reaction` | Player gives a gift | Opus 5.5, effort low, max 4,000 tokens, one retry |

Two more Anthropic calls are free (no generation): the Models API lookups in
**Settings → Test connections** (`/api/ai/check`) and the once-per-model
image-support check before the first photo.

Checked and found **not** to call Anthropic: page load and refresh, React
renders and effects, the autonomy loop (a 1-second `setInterval` of plain
rules), walking, pathfinding, collision, emotions, relationships, memories,
gift handling by characters, the approach reaction (`stage.onArrive`), the
`/api/ai/status` check, and the photo-pruning timer. A test now fails if any
file under `src/lib/autonomy`, `stage`, `mind`, `behavior` or `story` imports
the AI client or calls an API route (`tests/aiUsage.test.ts`).

No infinite loops or polling of Anthropic were found. Repeated clicks were
mostly guarded (talk/photo/gift allow one request per visitor at a time), but
two quick key presses on Z (Talk) could start two story-beat requests, story
beats/analysis/refinement had no rate limit, and identical requests were never
de-duplicated. A client that gives up (closes the tab) does not stop a request
already sent: Anthropic still bills it.

## 2. What was unnecessary

- **Opus for routine dialogue and narration.** Story-beat wording only phrases
  an outcome the game engine already decided; conversations are short structured
  replies. Opus was the most expensive choice for the most frequent requests.
- **Re-sending the same ~3,000-token rules and both character profiles with every
  conversation reply**, at full price.
- **AI wording for Observe and Wait** (the built-in lines are good, and these are
  the most-pressed buttons).
- **Large `max_tokens`** (8,000–16,000) on short replies. This doesn't cost money
  by itself, but it let a runaway reply cost up to 16,000 output tokens.
- **Double requests** from a double key press, and no way to see or cap spend.

## 3. What changed

- **Cheaper model per feature** (env overrides in parentheses):

  | Feature | Model now | Why |
  | --- | --- | --- |
  | Conversations, photo and gift reactions | `claude-sonnet-5-5` (`ANTHROPIC_TALK_MODEL`) | Half Opus's price; keeps adaptive thinking at low effort so boundary decisions and character voice stay intact |
  | Story-beat wording | `claude-haiku-5-5` (`ANTHROPIC_STORY_MODEL`) | 1/40 of Opus's price; the engine already decided what happens |
  | Personality analysis, refinement | `claude-opus-5-5` (`ANTHROPIC_MODEL`) | Rare, complex, and the result is reused in every later prompt |

- **Prompt caching**: every system prompt is cached, and in conversations the
  language, world and both character profiles are a second cached block, so
  every reply after the first in a conversation (within 5 minutes) reads ~3,800
  tokens from cache at 5% of the price. The per-reply part (relationship,
  mood, memories, recent turns, what was said) is sent fresh. The request was
  already limited to the relevant character data (last few turns, at most a
  handful of memories, no full game state), so nothing was removed from it.
- **Output caps**: conversations, photos, gifts 3,000 tokens; story beats 1,500;
  analysis/refinement 12,000; plus a global ceiling (`AI_MAX_OUTPUT_TOKENS`).
- **De-duplication**: identical requests running at the same time share one API
  call, and an identical request within 20 seconds reuses the answer. Failures
  are never reused, and "Run AI analysis again" and "Refine This Analysis" always ask again.
- **Click guard**: story buttons ignore a second press while one is running.
- **Bounded retries**: at most one automatic retry for network/429/5xx errors
  (none on conversation, photo and gift routes, which do their own single
  rule-check retry).
- **Usage modes, limits, budget and the dashboard** (below).

## 4. Estimated cost per typical dialogue

Estimates from prompt sizes (about 4 characters per token for English), not from
billing. The dashboard shows the real numbers once you play.

One conversation reply: ~3,000 tokens of rules and output schema, ~800–2,500
tokens of character profiles, ~300–1,000 tokens of current state, ~300–600
output tokens (reply plus a little thinking).

| | Before (Opus, no cache) | Now (Sonnet + cache) |
| --- | --- | --- |
| First reply in a conversation | ~$0.03 | ~$0.015 (writes the cache) |
| Each later reply | ~$0.03 | ~$0.006–0.008 |
| A 5-message conversation | **~$0.15** | **~$0.04** |
| One story beat (Talk/Twist!) | ~$0.017 | ~$0.0005 |
| Observe / Wait beat | ~$0.017 | $0 in Balanced mode |
| Personality analysis | ~$0.05–0.15 | unchanged (Opus) |

The cache lasts 5 minutes between replies; a long pause means the next reply
pays the first-reply price again.

## 5. Modes

| Mode | What calls Claude |
| --- | --- |
| **Offline** | Nothing. Built-in lines and saved data only. AI buttons are off. |
| **Balanced** (default) | Only what the player starts: conversations, photos, gifts, analysis/refinement, and Talk / Twist! / event beats. Observe and Wait use built-in lines. |
| **Full AI** | Also words Observe and Wait beats. Same limits and budget. |

No mode calls the AI from timers, movement or idle autonomy. Switch on the
dashboard (`/dev/usage`, development) or with `AI_MODE=offline|balanced|full`
in `.env.local`. Reload the game tab after switching.

## 6. Limits and the dashboard

Open <http://localhost:3000/dev/usage> while `npm run dev` is running (or
Settings → *Open the API usage dashboard*). It is a 404 in production builds
unless `AI_USAGE_DASHBOARD=1`. Opening it never calls Anthropic.

It shows, per feature: requests, the model used, input and output tokens, cache
writes and reads, estimated cost, average time, successes, failures, requests
blocked by a limit and requests saved by de-duplication; plus the last 50
requests. It stores numbers only: never keys, prompts, replies or photos.

Limits (dashboard, or `.env.local`; dashboard changes are saved to the git-ignored
`.plot-twist-ai.json`):

| Limit | Default | When reached |
| --- | --- | --- |
| Requests per minute (`AI_MAX_REQUESTS_PER_MINUTE`) | 20 | refused with "too many requests" and a retry time |
| Requests at once (`AI_MAX_CONCURRENT`) | 3 | refused with "too many requests" |
| Max output tokens (`AI_MAX_OUTPUT_TOKENS`) | 12,000 | caps every request's `max_tokens` |
| Session budget (`AI_SESSION_BUDGET_USD`) | $2.00 | refused with "budget used up" until you raise or reset it |

The per-visitor conversation limits in `src/lib/ai/server/limits.ts` still apply.

**The budget is not a billing cap.** It is this app's estimate from the token
counts Anthropic returns, it resets when the server restarts, and one request
already running can take it slightly over. To cap real spending, set a monthly
limit in the Anthropic Console (Settings → Limits).

## 7. How this was tested (without spending money)

- `tests/aiUsage.test.ts` (mocked SDK): models and thinking settings per
  feature, cache markers, output caps, the meter's cost maths, each mode, the
  per-minute / concurrency / budget limits, de-duplication, the dashboard API,
  and the "no AI in background code" check.
- `scripts/usage-check/`: a fake Anthropic server that counts requests, and a
  Playwright script that plays the game against it. Result on a production build:

  | Scenario | Anthropic requests |
  | --- | --- |
  | Homepage idle (30 s) | 0 |
  | Character Studio idle (30 s) | 0 |
  | Play Mode idle with characters moving on their own (60 s) | 0 |
  | Observe (Balanced) | 0 |
  | Talk button pressed twice quickly | 1 |
  | Start a conversation and send one message | 1 |
  | End the conversation | 0 |
  | Refresh, then idle (30 s) | 0 |
  | Usage dashboard open (15 s) | 0 |

  Limits over HTTP: with 2 per minute the third request got 429; with a tiny
  budget the third request was refused as "budget"; two identical requests at
  once made one upstream call; Offline and Balanced-Observe returned 503 without
  any upstream call.

Run it yourself:

```bash
node scripts/usage-check/mock-anthropic.mjs 4555 &
ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://127.0.0.1:4555 npx next dev -p 3100 &
node scripts/usage-check/background-usage.mjs http://localhost:3100 http://127.0.0.1:4555 30
```

Not tested live: reply quality on the new models. Sonnet 5.5 and Haiku 5.5 have
not been compared against Opus on real conversations here (that would spend
credits). If a character starts sounding off, set `ANTHROPIC_TALK_MODEL=claude-opus-5-5`
to go back for conversations only, and compare on the dashboard.
