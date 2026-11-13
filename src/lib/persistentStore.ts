"use client";

import { useSyncExternalStore } from "react";

/**
 * Tiny localStorage-backed store. Server render + first client render use the
 * defaults, then React swaps in the saved value (no hydration mismatch).
 */
export function createPersistentStore<T>(key: string, defaults: T, migrate?: (raw: unknown) => T) {
  let cache: T | null = null;
  const listeners = new Set<() => void>();

  const read = (): T => {
    if (cache) return cache;
    try {
      const raw = window.localStorage.getItem(key);
      cache = raw ? (migrate ? migrate(JSON.parse(raw)) : { ...defaults, ...JSON.parse(raw) }) : defaults;
    } catch {
      cache = defaults;
    }
    return cache as T;
  };

  const emit = () => listeners.forEach((l) => l());

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) {
        cache = null;
        emit();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  };

  const set = (update: T | ((prev: T) => T)) => {
    const next = typeof update === "function" ? (update as (p: T) => T)(read()) : update;
    cache = next;
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* storage full or blocked: keep in memory */
    }
    emit();
  };

  const reset = () => {
    cache = defaults;
    try {
      window.localStorage.removeItem(key);
    } catch {}
    emit();
  };

  const useStore = () => useSyncExternalStore(subscribe, read, () => defaults);

  return { useStore, set, reset, get: read };
}

const noop = () => () => {};
/** True once running in the browser with saved data loaded. */
export function useHydrated() {
  return useSyncExternalStore(noop, () => true, () => false);
}
