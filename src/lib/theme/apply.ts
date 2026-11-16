"use client";

/**
 * Puts a world skin on an element (normally <html>): CSS custom properties
 * from buildThemeVars() plus the data attributes CSS keys on. Passing null
 * restores the PLOT TWIST! brand theme by removing exactly what was set.
 * Also keeps a small cache so a reload into a world paints the right skin
 * before React starts (see THEME_BOOT_SCRIPT).
 */
import { buildThemeVars, themeAttributes, type WorldUiTheme } from "./themes";

const applied = new WeakMap<HTMLElement, string[]>();
const ATTRS = ["data-world-theme", "data-mood", "data-density", "data-motion-preset"];
export const THEME_CACHE_KEY = "plot-twist:theme-cache:v1";

export function applyTheme(el: HTMLElement, theme: WorldUiTheme | null, cacheFor?: string | null) {
  for (const k of applied.get(el) ?? []) el.style.removeProperty(k);
  ATTRS.forEach((a) => el.removeAttribute(a));
  applied.delete(el);
  if (!theme) {
    if (cacheFor !== undefined) writeCache(null);
    return;
  }
  const vars = buildThemeVars(theme);
  const attrs = themeAttributes(theme);
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  applied.set(el, Object.keys(vars));
  if (cacheFor) writeCache({ worldId: cacheFor, vars, attrs });
}

function writeCache(value: unknown) {
  try {
    if (value) window.localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(THEME_CACHE_KEY);
  } catch {
    /* storage blocked: the skin just appears after hydration */
  }
}

/**
 * Inline <head> script: on a world screen, re-apply the last skin of the
 * world this tab is in, so there is no flash of the brand theme on reload.
 * React then applies the authoritative theme (and removes it elsewhere).
 */
export const THEME_BOOT_SCRIPT = `(function(){try{if(!/^\\/(studio|builder|play)(\\/|$)/.test(location.pathname))return;var c=JSON.parse(localStorage.getItem(${JSON.stringify(THEME_CACHE_KEY)})||"null");if(!c)return;var a=sessionStorage.getItem("plot-twist:active-world");if(a&&a!==c.worldId)return;var e=document.documentElement;for(var k in c.vars)e.style.setProperty(k,c.vars[k]);for(var n in c.attrs)e.setAttribute(n,c.attrs[n]);}catch(_){}})();`;
