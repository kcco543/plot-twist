# Cloud saves

Players can sign in (email + password) and continue the same worlds on any device. Without the
Supabase settings the game works exactly as before (device-only saves) and Export/Import still work.

## What is synced

One **world bundle** per world (`src/lib/sync/bundle.ts`): the My Worlds entry (name, theme), the world's
save data (characters, personalities, relationships, memories, story log and progress, conversations,
scenes, UI skin…), its generated maps with their play-area / object layouts, and its photos and gifts.
Images are stored once each in Supabase Storage under their SHA-256 (`<user id>/<sha256>.<ext>`), so a
file never changes after upload and is verified on download. The character library and settings stay per device.

## Rules that keep saves safe

- **Device worlds are never uploaded automatically.** A world made while signed out belongs to the
  device (`WorldSave.owner` unset). Cloud saves → *Worlds only on this device* backs each one up, then
  adds it to the account unchanged. Signing in to an empty account never removes anything.
- **No silent overwrite.** Every save names the cloud version it was based on; `pt_save_world()` refuses
  it if the cloud moved on. Changes on two devices become a conflict the player settles: *Keep both*
  (recommended), *Keep this device's version* or *Use the other version*.
- **Backups.** Before anything replaces or removes a world on a device, a full copy goes to
  IndexedDB (`plot-twist-backups`, 8 per world): downloadable as a file or restorable as a copy.
  In the cloud, every replaced version is kept in `pt_world_versions` (30 per world).
- **Failures don't corrupt.** Downloads are written only after every image arrived and checked out,
  and only if the world didn't change locally meanwhile. Offline, everything saves locally and syncs
  when the connection returns.
- **Accounts are separate.** Row-level security: players read only their own rows and images; nobody
  writes the tables directly. On a shared device, an account's worlds are hidden (not deleted) while
  another account or nobody is signed in.
- The pre-v1.2 single save (`plot-twist:save:v1`) is never written.

## Setup

1. Apply `supabase/migrations/20261116090000_plot_twist_cloud_saves.sql` (new `pt_` tables, the
   `pt_save_world` function, the private `plot-twist-saves` bucket and its policies; nothing existing is changed).
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `..._ANON_KEY`) in `.env.local`.
3. If the project requires email confirmation, new players confirm by email once, then sign in.

## Tests

- `tests/sync.test.ts`: two simulated devices + an in-memory cloud: full round trip, conflicts,
  dropped connection mid-download, offline edits, deletes, account switching, export/import.
- `tests/syncSupabase.test.ts`: the same against a real Supabase, plus row-level security. Run
  `supabase start && supabase migration up`, then
  `SUPABASE_TEST_URL=http://127.0.0.1:54321 SUPABASE_TEST_KEY=<publishable key> npx vitest run tests/syncSupabase.test.ts`.
