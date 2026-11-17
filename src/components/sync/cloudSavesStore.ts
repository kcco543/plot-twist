"use client";

import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openCloudSaves() {
  open = true;
  emit();
}
export function closeCloudSaves() {
  open = false;
  emit();
}
export function useCloudSavesOpen() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => open,
    () => false,
  );
}
