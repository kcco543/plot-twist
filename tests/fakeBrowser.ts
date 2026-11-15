import { vi } from "vitest";

/** In-memory localStorage / sessionStorage. */
export class FakeStorage {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

/** A fake browser window whose storage survives `reload()` (module memory does not). */
export function fakeBrowser() {
  const local = new FakeStorage();
  const session = new FakeStorage();
  const navigations: string[] = [];
  vi.stubGlobal("window", {
    localStorage: local,
    sessionStorage: session,
    location: { assign: (href: string) => navigations.push(href), reload: () => navigations.push("reload"), search: "" },
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  return { local, session, navigations };
}
