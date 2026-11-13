"use client";

import { useEffect } from "react";
import { useSettings } from "@/lib/settingsStore";

/** Mirrors settings onto <html> so global CSS can react to them. */
export function SettingsEffect() {
  const { crt, reduceMotion } = useSettings();
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.crt = crt ? "on" : "off";
    el.dataset.motion = reduceMotion ? "reduced" : "full";
  }, [crt, reduceMotion]);
  return null;
}
