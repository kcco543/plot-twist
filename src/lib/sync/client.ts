"use client";

/**
 * CLOUD SAVES — browser side: sign-in, automatic sync and the sync status
 * --------------------------------------------------------------------------
 * Started once by <AppEffects />. Needs NEXT_PUBLIC_SUPABASE_URL and
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or ..._ANON_KEY); without them the
 * game works exactly as before and cloud saves say "not set up".
 *
 * Sync runs a couple of seconds after any change to a world (its data, maps,
 * photos or gifts), when the tab comes back into view, when the connection
 * returns, and every 45 seconds while the tab is open. Offline, everything
 * keeps saving on this device and goes up when the connection is back.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useSyncExternalStore } from "react";
import { subscribeKeepsakes } from "../keepsakes/store";
import { subscribeMaps } from "../mapLibrary";
import { allWorlds, setWorldOwner, subscribeWorlds } from "../saves/worldSaves";
import { currentAccount, setCurrentAccount, type AccountInfo } from "./account";
import { backupWorld } from "./backups";
import { CloudError, supabaseCloud } from "./cloud";
import { SyncBusy, SyncEngine, type Conflict, type SyncReport } from "./engine";

export type SyncPhase = "unconfigured" | "signed-out" | "saving" | "synced" | "offline" | "error" | "conflict";

export type SyncStatus = {
  phase: SyncPhase;
  account: AccountInfo | null;
  lastSyncedAt: number | null;
  /** What went wrong last time (shown with Sync failed). */
  error: "network" | "auth" | "server" | "invalid" | null;
  conflicts: Conflict[];
  /** This device's own worlds, not in any account yet. */
  deviceWorlds: number;
  /** Worlds on this device of an account that is not signed in here. */
  hiddenWorlds: number;
  lastReport: SyncReport | null;
};

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
export const cloudConfigured = () => Boolean(URL_ && KEY);

const initial: SyncStatus = { phase: "signed-out", account: null, lastSyncedAt: null, error: null, conflicts: [], deviceWorlds: 0, hiddenWorlds: 0, lastReport: null };
let status: SyncStatus = initial;
const SERVER_STATUS: SyncStatus = { ...initial, phase: "signed-out" };
const listeners = new Set<() => void>();

function counts(accountId: string | null) {
  const ws = allWorlds();
  return { deviceWorlds: ws.filter((w) => !w.owner).length, hiddenWorlds: ws.filter((w) => w.owner && w.owner !== accountId).length };
}

function setStatus(patch: Partial<SyncStatus>) {
  const next = { ...status, ...patch };
  next.account = currentAccount();
  Object.assign(next, counts(next.account?.id ?? null));
  if (engine) next.conflicts = engine.conflicts();
  status = next;
  listeners.forEach((l) => l());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => status,
    () => SERVER_STATUS,
  );
}
export const getSyncStatus = () => status;

let client: SupabaseClient | null = null;
let engine: SyncEngine | null = null;
let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;

function supabase(): SupabaseClient | null {
  if (!cloudConfigured()) return null;
  client ??= createClient(URL_, KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "plot-twist:auth", detectSessionInUrl: true } });
  return client;
}

export function deviceName(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh|Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Browser";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return br ? `${os} · ${br}` : os;
}

let copyName = (name: string) => `${name || "World"} (other device)`;
/** The i18n layer gives the name for "Keep both" copies. */
export function setCopyNamer(fn: (name: string) => string) {
  copyName = fn;
}

function switchAccount(a: AccountInfo | null) {
  const before = currentAccount()?.id ?? null;
  setCurrentAccount(a);
  engine = a && client ? new SyncEngine(supabaseCloud(client, a.id), { device: deviceName(), copyName: (n) => copyName(n) }) : null;
  if ((a?.id ?? null) !== before) failures = 0;
}

/** Start cloud saves for this tab (idempotent). */
export function startSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  const sb = supabase();
  if (!sb) {
    setStatus({ phase: "unconfigured" });
    return;
  }
  // Signed-in state is known right away from storage, even offline.
  const known = currentAccount();
  if (known) switchAccount(known);
  setStatus({ phase: known ? (navigator.onLine ? "saving" : "offline") : "signed-out" });

  sb.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      const a = { id: session.user.id, email: session.user.email ?? "" };
      if (currentAccount()?.id !== a.id || !engine) switchAccount(a);
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") schedule(0);
    } else if (event === "SIGNED_OUT") {
      switchAccount(null);
      setStatus({ phase: "signed-out", lastSyncedAt: null, error: null, lastReport: null });
    }
  });

  const kick = () => schedule(2000);
  subscribeWorlds(kick);
  subscribeMaps(kick);
  subscribeKeepsakes(kick);
  window.addEventListener("online", () => schedule(0));
  window.addEventListener("offline", () => engine && setStatus({ phase: "offline" }));
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && schedule(0));
  setInterval(() => document.visibilityState === "visible" && schedule(0), 45_000);
}

function schedule(ms: number) {
  if (!engine) return;
  if (timer) clearTimeout(timer);
  if (status.phase !== "saving" && status.phase !== "offline") setStatus({ phase: "saving" });
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, ms);
}

/** Sync right away (also the "Sync now" / "Retry" button). */
export async function syncNow(): Promise<void> {
  const e = engine;
  if (!e) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    setStatus({ phase: "offline" });
    return;
  }
  setStatus({ phase: "saving" });
  try {
    const report = await e.sync();
    if (e !== engine) return;
    failures = 0;
    const conflicts = e.conflicts();
    const failed = report.failed.length > 0;
    setStatus({ phase: conflicts.length ? "conflict" : failed ? "error" : "synced", lastSyncedAt: Date.now(), error: failed ? report.failed[0].error.kind : null, lastReport: report });
    if (failed) retryLater();
  } catch (err) {
    if (e !== engine) return;
    if (err instanceof SyncBusy) {
      setStatus({ phase: status.lastSyncedAt ? "synced" : "saving" });
      schedule(5000);
      return;
    }
    const kind = err instanceof CloudError ? err.kind : "server";
    setStatus({ phase: kind === "network" ? "offline" : "error", error: kind });
    retryLater();
  }
}

function retryLater() {
  failures++;
  schedule(Math.min(120_000, 4000 * 2 ** Math.min(failures, 5)));
}

// ---------------------------------------------------------------- account

export type AuthResult = { ok: true; needsConfirmation?: boolean } | { ok: false; reason: "invalid" | "exists" | "weak" | "network" | "unconfirmed" | "rate" | "other"; message?: string };

function authError(e: { message?: string; status?: number; code?: string } | null): AuthResult {
  const m = e?.message ?? "";
  if (/fetch|network/i.test(m) || e?.status === 0) return { ok: false, reason: "network", message: m };
  if (/not confirmed/i.test(m) || e?.code === "email_not_confirmed") return { ok: false, reason: "unconfirmed", message: m };
  if (/already registered|already exists/i.test(m) || e?.code === "user_already_exists") return { ok: false, reason: "exists", message: m };
  if (/password/i.test(m) && /least|weak|short/i.test(m)) return { ok: false, reason: "weak", message: m };
  if (/rate limit|too many/i.test(m) || e?.status === 429) return { ok: false, reason: "rate", message: m };
  if (/invalid login|credentials/i.test(m) || e?.code === "invalid_credentials") return { ok: false, reason: "invalid", message: m };
  return { ok: false, reason: "other", message: m };
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "other" };
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) return authError(error);
    switchAccount({ id: data.user.id, email: data.user.email ?? "" });
    schedule(0);
    return { ok: true };
  } catch (e) {
    return authError(e as Error);
  }
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "other" };
  try {
    const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
    if (error) return authError(error);
    // Supabase answers a sign-up for an existing address with a user that has no identities.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return { ok: false, reason: "exists" };
    if (data.session && data.user) {
      switchAccount({ id: data.user.id, email: data.user.email ?? "" });
      schedule(0);
      return { ok: true };
    }
    return { ok: true, needsConfirmation: true };
  } catch (e) {
    return authError(e as Error);
  }
}

/**
 * Sign out. Tries to send the last changes first. This account's worlds stay
 * on this device but are hidden until it signs in again; the page reloads
 * so nothing of them stays in memory.
 */
export async function signOut(): Promise<void> {
  if (engine && navigator.onLine) await syncNow().catch(() => {});
  try {
    await supabase()?.auth.signOut({ scope: "local" });
  } catch {}
  switchAccount(null);
  setStatus({ phase: "signed-out", lastSyncedAt: null, error: null, lastReport: null });
  window.location.assign("/");
}

/**
 * Add some of this device's own worlds to the signed-in account. Each one is
 * backed up first; nothing in it changes except who it belongs to, then sync
 * uploads it (or, if the account already has it, compares the two).
 */
export async function addWorldsToAccount(ids: string[]): Promise<number> {
  const a = currentAccount();
  if (!a || !engine) return 0;
  const mine = allWorlds().filter((w) => ids.includes(w.id) && !w.owner);
  for (const w of mine) await backupWorld(w.id, "before-cloud-import");
  setWorldOwner(
    mine.map((w) => w.id),
    a.id,
  );
  setStatus({});
  await syncNow();
  return mine.length;
}

export async function resolveConflict(worldId: string, choice: "keep-both" | "use-local" | "use-cloud"): Promise<boolean> {
  const e = engine;
  if (!e) return false;
  setStatus({ phase: "saving" });
  try {
    await e.resolve(worldId, choice);
    await syncNow();
    return true;
  } catch (err) {
    setStatus({ phase: err instanceof CloudError && err.kind === "network" ? "offline" : "error", error: err instanceof CloudError ? err.kind : "server" });
    return false;
  }
}

export const syncStateFor = (worldId: string) => (engine ? engine.state().worlds[worldId] : undefined);
