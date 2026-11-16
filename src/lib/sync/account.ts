/**
 * Which cloud account this browser is signed in to, readable synchronously
 * (the world list needs it on first render, even offline). Written by the
 * sync client when the sign-in changes. No window = nobody signed in.
 *
 * Worlds that belong to an account (WorldSave.owner) are shown only while
 * that account is signed in here; worlds with no owner are this device's own
 * and always shown. Hiding never deletes anything.
 */
export const ACCOUNT_KEY = "plot-twist:sync:account";

export type AccountInfo = { id: string; email: string };

const listeners = new Set<() => void>();
let cached: { raw: string | null; value: AccountInfo | null } | null = null;

export function currentAccount(): AccountInfo | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(ACCOUNT_KEY);
  } catch {}
  if (cached && cached.raw === raw) return cached.value;
  let value: AccountInfo | null = null;
  try {
    const p = raw ? JSON.parse(raw) : null;
    if (p && typeof p.id === "string" && p.id) value = { id: p.id, email: typeof p.email === "string" ? p.email : "" };
  } catch {}
  cached = { raw, value };
  return value;
}

export const currentAccountId = () => currentAccount()?.id ?? null;

export function setCurrentAccount(a: AccountInfo | null) {
  try {
    if (a) window.localStorage.setItem(ACCOUNT_KEY, JSON.stringify(a));
    else window.localStorage.removeItem(ACCOUNT_KEY);
  } catch {}
  cached = null;
  listeners.forEach((l) => l());
}

export function subscribeAccount(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** Can this tab see a world with this owner? */
export const visibleTo = (owner: string | undefined, accountId: string | null) => !owner || owner === accountId;
