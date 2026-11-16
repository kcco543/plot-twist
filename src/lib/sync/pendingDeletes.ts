/**
 * Worlds of an account deleted on this device whose cloud copy still has to
 * be deleted (kept here so a delete made offline is not forgotten).
 */
export const PENDING_DELETES_KEY = "plot-twist:sync:pending-deletes";

export type PendingDelete = { id: string; owner: string; at: number };

export function pendingDeletes(): PendingDelete[] {
  try {
    const p = JSON.parse(window.localStorage.getItem(PENDING_DELETES_KEY) ?? "[]");
    return Array.isArray(p) ? p.filter((d) => d && typeof d.id === "string" && typeof d.owner === "string") : [];
  } catch {
    return [];
  }
}

function write(list: PendingDelete[]) {
  try {
    if (list.length) window.localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(list));
    else window.localStorage.removeItem(PENDING_DELETES_KEY);
  } catch {}
}

export function recordCloudDelete(id: string, owner: string) {
  if (typeof window === "undefined") return;
  write([...pendingDeletes().filter((d) => d.id !== id), { id, owner, at: Date.now() }]);
}

export function clearPendingDelete(id: string) {
  write(pendingDeletes().filter((d) => d.id !== id));
}
