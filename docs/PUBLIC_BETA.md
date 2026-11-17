# Public beta: hosting, access and AI cost limits

How the shareable beta of PLOT TWIST! is protected and deployed. Local development
(`npm run dev` at <http://localhost:3000>) works exactly as before unless you set
`BETA_ACCESS_CODES` in `.env.local`.

## 1. Who can use the AI

- **Everyone** can play: worlds, scenes, characters, the Character Library,
  movement, camera, autonomy, relationships, memories, story log, the built-in
  map kit and built-in dialogue all run in the browser with no AI calls.
- **AI features need a tester code.** On the title screen (*Public beta* panel)
  a visitor types the code; the server checks it against `BETA_ACCESS_CODES` and
  sets a signed, HttpOnly cookie (30 days). The browser never learns the valid
  codes, and wrong guesses are limited (8 per 15 minutes per network).
- The check is on the server, twice: `src/middleware.ts` refuses every
  `/api/ai/*` route except `/api/ai/status` without a valid pass, and each route
  calls `betaGuard()` (`src/lib/ai/server/beta.ts`) before contacting a provider.
  Calling the API directly without a pass gets `401 beta_locked`.
- In production the gate is **on by default and fails closed**: with no codes
  configured nobody can use the AI. `BETA_OPEN=1` removes the code requirement
  (allowances still apply per network address); not recommended.
- To revoke access: remove that code from `BETA_ACCESS_CODES` (its passes stop
  working at once) or change all codes (everyone must re-enter).

## 2. Daily allowances (server-side)

Every paid request takes units from three daily buckets at once: the tester,
their network address (3x a tester's allowance, so clearing cookies doesn't
reset it) and the whole site. If any bucket is full, the request is refused
**before** the provider is contacted (`429 quota`), and the game falls back to
built-in lines with a friendly message. Buckets reset at midnight UTC.
Requests that never reached the provider (not configured, rate limited,
billing errors…) are given back.

| Feature | Units | Kind |
| --- | --- | --- |
| Conversation reply, story beat | 1 | text |
| Photo / gift reaction | 2 | text |
| Personality analysis, refinement (Opus) | 4 | text |
| Autonomous conversation between characters | 1 | auto |
| Pixel character, map, map edit, gift picture | 1 | image |

| Variable | Default | Meaning |
| --- | --- | --- |
| `BETA_TEXT_PER_DAY` | 60 | text units per tester per day |
| `BETA_AUTO_PER_DAY` | 15 | autonomous conversations per tester per day |
| `BETA_IMAGES_PER_DAY` | **0** | image generations per tester per day (0 = images off) |
| `BETA_TEXT_DAILY_LIMIT` | 600 | text units for the whole site per day |
| `BETA_AUTO_DAILY_LIMIT` | 200 | autonomous conversations, whole site per day |
| `BETA_IMAGES_DAILY_LIMIT` | 10 | image generations, whole site per day |

On top of that, the existing limits still apply (`docs/AI_COSTS.md`): one
request at a time per tester, 12 replies/minute, 20 requests/minute and 3 at
once per server instance, capped output tokens, de-duplication, and the
in-memory `AI_SESSION_BUDGET_USD` estimate per server instance.

**Rough worst case per day** with the defaults: 600 text units (mostly Sonnet
replies at ~$0.006–0.015) + 200 Haiku conversations ≈ **$5–10/day** if every
tester used everything. Typical use is far lower.

**Where counts live.** With `SUPABASE_SECRET_KEY` set, counts are stored in the
`pt_ai_quota` table through `pt_take_ai_quota()` (only the secret key may call
it; migration `supabase/migrations/20261117210000_plot_twist_ai_quota.sql`), so
every Vercel instance shares them. Without it, each server instance counts in
memory (still enforced, but looser: a cold start resets it).

**Hard caps belong at the providers.** Set a monthly spend limit in the
Anthropic Console (Settings → Limits) and, if images are ever enabled, a project
budget in the OpenAI dashboard. The app's limits are a second line of defence.

**Monitoring.** In production every AI request logs one line of numbers
(`[ai-usage] feature model ok in=… out=… $…`) to Vercel → Logs. Daily totals
per bucket are in the `pt_ai_quota` table (Supabase → Table Editor):
`site:text`, `site:auto`, `site:image` rows are the whole site's usage per day.

## 3. Saves

- **Browser saves** (default): every world, scene, character, portrait,
  relationship, memory, gift, story log and generated map is saved in the
  visitor's own browser (localStorage + IndexedDB). They survive reloads, are
  private to that browser, and are not visible to other visitors. They do
  **not** move between browsers or devices on their own.
- **Cloud saves** (optional, existing feature): signing in under *Cloud saves*
  syncs worlds to Supabase with row-level security (players can only read their
  own rows and images; writes go through `pt_save_world()`). Cross-device sync is
  tested in `tests/sync.test.ts` / `tests/syncSupabase.test.ts`. The beta adds
  caps of 60 worlds and 600 image files per player.
- **The Character Library and settings stay per browser** (not synced).
- **Your localhost worlds stay on localhost.** Browsers keep storage per site,
  so `http://localhost:3000` and the public URL don't share saves. To bring a
  world over: on localhost, *My Worlds → Export* (or *Cloud saves → add to
  account*), then on the public site *Import Save* (or sign in to the same
  account). Nothing on localhost is changed or removed by the beta.

## 4. Uploads and images

- Reference images for pixel characters: PNG/JPG/WebP only (checked by file
  signature, not extension), ≤ 8 MB, never stored on the server.
- Photos shown to characters: checked type and size (≤ 1.8 MB after the
  browser shrinks them), sent to the model and dropped, never stored or logged.
- Generated images are returned to the browser and saved there; with cloud
  saves they go to the private `plot-twist-saves` bucket under the player's own
  folder.
- Note: Vercel limits request and response bodies to 4.5 MB. Map edits and
  large reference images can exceed that, which is one more reason image
  generation is off by default in the beta.

## 5. Deploying to Vercel

1. Vercel → *Add New → Project* → import `kcco543/plot-twist` (framework: Next.js,
   defaults are fine). Production branch: `main`.
2. *Settings → Environment Variables* (Production), entered in Vercel only:

   | Name | Value | Secret? |
   | --- | --- | --- |
   | `ANTHROPIC_API_KEY` | your Anthropic key | yes |
   | `BETA_ACCESS_CODES` | one or more codes, comma-separated, 6+ characters | yes |
   | `BETA_COOKIE_SECRET` | a long random string (optional but recommended) | yes |
   | `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API keys → secret key | yes |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (same as `.env.local`) | no |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key (same as `.env.local`) | no |
   | `AI_SESSION_BUDGET_USD` | e.g. `5` (per-instance estimate) | no |

   Leave `OPENAI_API_KEY` unset (or set `BETA_IMAGES_PER_DAY=0`) to keep image
   generation off. Never set `AI_TALK_MOCK`, `AI_USAGE_DASHBOARD` or `BETA_OPEN`
   in production.
3. Supabase → *Authentication → URL Configuration*: add the Vercel URL
   (`https://<project>.vercel.app/**`) to the redirect URLs so sign-up
   confirmation emails return to the public site. Supabase's built-in email
   sender allows only a few emails per hour: for a class-sized beta either turn
   off *Confirm email* or configure custom SMTP.
4. Deploy, then open the URL in a private window and follow the tester guide.

## 6. Tests

- `tests/beta.test.ts`: pass signing/forgery/expiry/revocation, code guessing
  limit, locked routes, allowances per tester / network / site, refunds,
  images off, status, middleware.
- `scripts/usage-check/beta-visitor.mjs`: a new visitor on a production build
  against the mock Anthropic server (no cost): welcome panel, zero AI requests
  while locked, direct API refused, wrong/right code, AI conversation, save
  persists after reload, dev tools hidden, phone/tablet layouts.
