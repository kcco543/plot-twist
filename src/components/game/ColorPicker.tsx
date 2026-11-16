"use client";

import { useEffect, useRef, useState } from "react";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { hexToRgb, hslToRgb, hsvToRgb, nearestInPalette, parseHex, pushRecent, rgbToHex, rgbToHsl, rgbToHsv, type HSV } from "@/lib/color/color";
import { pantoneMatch } from "@/lib/color/pantone";
import { useI18n } from "@/i18n";

const STORE = "plot-twist:colors:v1";
type Stored = { recent: string[]; saved: string[] };
function load(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "{}") as Partial<Stored>;
    const ok = (a: unknown) => (Array.isArray(a) ? a.map((x) => (typeof x === "string" ? parseHex(x) : null)).filter((x): x is string => !!x) : []);
    return { recent: ok(raw.recent).slice(0, 12), saved: ok(raw.saved).slice(0, 32) };
  } catch {
    return { recent: [], saved: [] };
  }
}
function store(s: Stored) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* private window or storage full: the lists just won't be remembered */
  }
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

/**
 * Colour picker for the pixel editor: hue strip + saturation/value square,
 * HEX / RGB / HSL inputs, current vs previous colour, the sprite's palette,
 * recent colours and saved swatches (remembered in this browser), an
 * eyedropper (from the canvas, or from anywhere on screen where the browser
 * supports it), optional limited-palette mode, and an honest Pantone section.
 */
export function ColorPicker({
  value,
  onChange,
  palette,
  onPickFromCanvas,
  picking,
}: {
  value: string;
  onChange: (hex: string) => void;
  /** The sprite's own colours + the house palette (limited-palette mode snaps to these). */
  palette: string[];
  /** Turn on the canvas eyedropper (the next click on the drawing picks its colour). */
  onPickFromCanvas: () => void;
  picking: boolean;
}) {
  const { t } = useI18n();
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(hexToRgb(value)));
  const [previous, setPrevious] = useState(value);
  const [lists, setLists] = useState<Stored>({ recent: [], saved: [] });
  const [limited, setLimited] = useState(false);
  const [hexDraft, setHexDraft] = useState(value);
  const committed = useRef(value);
  useEffect(() => setLists(load()), []);

  // Outside changes (canvas eyedropper, palette click) move the picker; our own hue is kept for greys.
  useEffect(() => {
    if (value === rgbToHex(hsvToRgb(hsv))) return;
    const next = rgbToHsv(hexToRgb(value));
    setHsv((h) => (next.s === 0 || next.v === 0 ? { ...next, h: h.h } : next));
    setHexDraft(value);
    // Picked from the canvas: that's a finished choice too (previous + recent).
    if (value !== committed.current) {
      setPrevious(committed.current);
      committed.current = value;
      setLists((l) => {
        const n = { ...l, recent: pushRecent(l.recent, value) };
        store(n);
        return n;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  /** Set the colour (snapped to the palette in limited mode). `final` = the end of a drag / a click: remembered as recent. */
  const set = (hex: string, final = true, fromHsv?: HSV) => {
    const out = limited && palette.length ? nearestInPalette(hex, palette) : hex;
    if (fromHsv && out === hex) setHsv(fromHsv);
    else setHsv((h) => {
      const n = rgbToHsv(hexToRgb(out));
      return n.s === 0 || n.v === 0 ? { ...n, h: h.h } : n;
    });
    setHexDraft(out);
    if (out !== value) onChange(out);
    if (final && out !== committed.current) {
      setPrevious(committed.current);
      committed.current = out;
      setLists((l) => {
        const next = { ...l, recent: pushRecent(l.recent, out) };
        store(next);
        return next;
      });
    }
  };
  const setHsvColor = (h: HSV, final: boolean) => set(rgbToHex(hsvToRgb(h)), final, h);

  const rgb = hexToRgb(value);
  const hsl = rgbToHsl(rgb);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const fromSv = (e: React.PointerEvent, final: boolean) => {
    const r = svRef.current!.getBoundingClientRect();
    const s = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 100);
    const v = Math.round((1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))) * 100);
    setHsvColor({ h: hsv.h, s, v }, final);
  };
  const fromHue = (e: React.PointerEvent, final: boolean) => {
    const r = hueRef.current!.getBoundingClientRect();
    setHsvColor({ ...hsv, h: Math.round(Math.min(0.9972, Math.max(0, (e.clientX - r.left) / r.width)) * 360) }, final);
  };
  const drag = (fn: (e: React.PointerEvent, final: boolean) => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      fn(e, false);
    },
    onPointerMove: (e: React.PointerEvent) => e.currentTarget.hasPointerCapture(e.pointerId) && fn(e, false),
    onPointerUp: (e: React.PointerEvent) => fn(e, true),
  });

  const num = (label: string, v: number, max: number, onSet: (n: number) => void) => (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="font-label text-[9px] uppercase text-ink-mute">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={v}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onSet(Math.min(max, Math.max(0, Math.round(n))));
        }}
        className="px-focus w-full min-w-0 bg-well px-1.5 py-1 text-base tabular-nums shadow-[inset_0_0_0_2px_var(--color-line)]"
      />
    </label>
  );
  const swatch = (hex: string, key: string, extra?: React.ReactNode) => (
    <span key={key} className="relative">
      <button
        type="button"
        aria-label={t("editor.color", { hex })}
        aria-pressed={value === hex}
        onClick={() => set(hex)}
        className={`px-focus block aspect-square w-full min-h-7 ${value === hex ? "shadow-[0_0_0_3px_var(--color-ink)]" : "shadow-[0_0_0_2px_var(--color-line)]"}`}
        style={{ background: hex }}
      />
      {extra}
    </span>
  );
  const eyeDropper = typeof window !== "undefined" ? (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper : undefined;
  const pantone = pantoneMatch(value);
  const savedHas = lists.saved.includes(value);

  return (
    <div className="@container flex min-w-0 flex-col gap-3" data-color-picker>
      {/* Saturation / value square and hue strip */}
      <div
        ref={svRef}
        role="slider"
        tabIndex={0}
        aria-label={t("editor.colorPicker.sv")}
        aria-valuetext={`${t("editor.colorPicker.saturation")} ${hsv.s}%, ${t("editor.colorPicker.value")} ${hsv.v}%`}
        onKeyDown={(e) => {
          const d = e.shiftKey ? 10 : 2;
          const k = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }[e.key];
          if (!k) return;
          e.preventDefault();
          setHsvColor({ h: hsv.h, s: Math.min(100, Math.max(0, hsv.s + k[0])), v: Math.min(100, Math.max(0, hsv.v + k[1])) }, true);
        }}
        {...drag(fromSv)}
        className="px-focus relative h-36 w-full cursor-crosshair touch-none shadow-[0_0_0_2px_var(--color-line)] sm:h-40"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}
        data-sv
      >
        <span
          aria-hidden
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 translate-y-1/2 border-2 border-white shadow-[0_0_0_1px_#000]"
          style={{ left: `${hsv.s}%`, bottom: `${hsv.v}%`, background: value }}
        />
      </div>
      <div
        ref={hueRef}
        role="slider"
        tabIndex={0}
        aria-label={t("editor.colorPicker.hue")}
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={hsv.h}
        onKeyDown={(e) => {
          const d = { ArrowLeft: -(e.shiftKey ? 15 : 3), ArrowRight: e.shiftKey ? 15 : 3 }[e.key as "ArrowLeft"];
          if (!d) return;
          e.preventDefault();
          setHsvColor({ ...hsv, h: (hsv.h + d + 360) % 360 }, true);
        }}
        {...drag(fromHue)}
        className="px-focus relative h-6 w-full cursor-pointer touch-none shadow-[0_0_0_2px_var(--color-line)]"
        style={{ background: "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)" }}
        data-hue
      >
        <span aria-hidden className="pointer-events-none absolute inset-y-[-3px] w-1.5 -translate-x-1/2 border-2 border-white shadow-[0_0_0_1px_#000]" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>

      {/* Current vs previous */}
      <div className="grid grid-cols-2 gap-2 text-sm" data-compare>
        {(
          [
            ["current", value],
            ["previous", previous],
          ] as const
        ).map(([k, hex]) => {
          const c = hexToRgb(hex);
          return (
            <button
              key={k}
              type="button"
              disabled={k === "current"}
              onClick={() => set(hex)}
              className="px-focus flex items-center gap-2 bg-well p-1.5 text-left shadow-[inset_0_0_0_2px_var(--color-line)] disabled:cursor-default"
              title={k === "previous" ? t("editor.colorPicker.usePrevious") : undefined}
            >
              <span className="size-8 shrink-0 shadow-[0_0_0_2px_var(--color-line)]" style={{ background: hex }} />
              <span className="min-w-0 leading-tight">
                <span className="block font-label text-[9px] uppercase text-ink-mute">{t(`editor.colorPicker.${k}`)}</span>
                <span className="block font-bold tabular-nums">{hex.toUpperCase()}</span>
                <span className="block text-xs tabular-nums text-ink-soft">
                  RGB {c.r}, {c.g}, {c.b}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Values */}
      <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-1.5">
        <label className="flex min-w-0 flex-col gap-0.5">
          <span className="font-label text-[9px] uppercase text-ink-mute">HEX</span>
          <input
            value={hexDraft}
            spellCheck={false}
            autoCapitalize="off"
            maxLength={7}
            onChange={(e) => {
              setHexDraft(e.target.value);
              const h = parseHex(e.target.value);
              if (h && (e.target.value.replace("#", "").length === 6 || e.target.value.replace("#", "").length === 3)) set(h);
            }}
            onBlur={() => setHexDraft(value)}
            aria-invalid={!parseHex(hexDraft)}
            className="px-focus w-full min-w-0 bg-well px-1.5 py-1 font-mono text-base uppercase shadow-[inset_0_0_0_2px_var(--color-line)] aria-[invalid=true]:shadow-[inset_0_0_0_2px_var(--color-coral)]"
          />
        </label>
        {num("R", rgb.r, 255, (n) => set(rgbToHex({ ...rgb, r: n })))}
        {num("G", rgb.g, 255, (n) => set(rgbToHex({ ...rgb, g: n })))}
        {num("B", rgb.b, 255, (n) => set(rgbToHex({ ...rgb, b: n })))}
      </div>
      <details>
        <summary className="cursor-pointer font-label text-[10px] uppercase text-label">HSL</summary>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          {num("H", hsl.h, 359, (n) => set(rgbToHex(hslToRgb({ ...hsl, h: n }))))}
          {num("S %", hsl.s, 100, (n) => set(rgbToHex(hslToRgb({ ...hsl, s: n }))))}
          {num("L %", hsl.l, 100, (n) => set(rgbToHex(hslToRgb({ ...hsl, l: n }))))}
        </div>
      </details>

      {/* Eyedropper + limited palette */}
      <div className="flex flex-wrap items-center gap-2">
        <PixelButton size="sm" variant={picking ? "accent" : "ghost"} icon="drop" aria-pressed={picking} onClick={onPickFromCanvas}>
          {t("editor.picker")}
        </PixelButton>
        {eyeDropper && (
          <PixelButton
            size="sm"
            variant="ghost"
            icon="eye"
            onClick={() =>
              void new eyeDropper()
                .open()
                .then((r) => {
                  const h = parseHex(r.sRGBHex);
                  if (h) set(h);
                })
                .catch(() => {})
            }
          >
            {t("editor.colorPicker.screen")}
          </PixelButton>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={limited} onChange={(e) => setLimited(e.target.checked)} className="size-5 accent-[var(--color-label)]" data-limited />
          {t("editor.colorPicker.limited")}
        </label>
      </div>
      {limited && <p className="text-xs text-ink-soft">{t("editor.colorPicker.limitedNote", { n: palette.length })}</p>}

      {/* Palette (the sprite's colours + house colours) */}
      <section>
        <h4 className="mb-1 font-label text-[10px] uppercase text-label">{t("editor.colorPicker.palette")}</h4>
        <div className="grid grid-cols-8 gap-1.5">{palette.map((hex) => swatch(hex, `p${hex}`))}</div>
      </section>
      {lists.recent.length > 0 && (
        <section data-recent>
          <h4 className="mb-1 font-label text-[10px] uppercase text-label">{t("editor.colorPicker.recent")}</h4>
          <div className="grid grid-cols-8 gap-1.5">{lists.recent.map((hex) => swatch(hex, `r${hex}`))}</div>
        </section>
      )}

      {/* Saved swatches (left) and Pantone (lower right) */}
      <div className="grid gap-3 @md:grid-cols-2">
        <section data-saved>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-label text-[10px] uppercase text-label">{t("editor.colorPicker.saved")}</h4>
            <PixelButton
              size="sm"
              variant="ghost"
              icon={savedHas ? "close" : "plus"}
              onClick={() =>
                setLists((l) => {
                  const next = { ...l, saved: savedHas ? l.saved.filter((x) => x !== value) : [...l.saved, value].slice(-32) };
                  store(next);
                  return next;
                })
              }
            >
              {savedHas ? t("editor.colorPicker.unsave") : t("editor.colorPicker.save")}
            </PixelButton>
          </div>
          {lists.saved.length ? (
            <div className="grid grid-cols-8 gap-1.5 @md:grid-cols-6">{lists.saved.map((hex) => swatch(hex, `s${hex}`))}</div>
          ) : (
            <p className="text-xs text-ink-mute">{t("editor.colorPicker.savedEmpty")}</p>
          )}
        </section>
        <section className="flex flex-col gap-1 self-end bg-lavender-hi/60 p-2 text-xs leading-snug shadow-[inset_0_0_0_2px_var(--color-lavender)]" data-pantone={pantone.status}>
          <h4 className="flex items-center gap-1.5 font-label text-[10px] uppercase text-label">
            <PixelIcon name="bookmark" size={10} /> Pantone®
          </h4>
          {pantone.status === "match" ? (
            <>
              <p className="flex items-center gap-2">
                <span className="size-5 shrink-0 shadow-[0_0_0_2px_var(--color-line)]" style={{ background: pantone.entry.hex }} />
                <span className="font-bold">{pantone.entry.code}</span>
                {pantone.entry.name && <span className="text-ink-soft">{pantone.entry.name}</span>}
              </p>
              <p className={pantone.verified ? "text-ink-soft" : "font-bold text-coral-deep"}>{pantone.verified ? t("editor.pantone.verified", { source: pantone.provider }) : t("editor.pantone.unverified", { source: pantone.provider })}</p>
            </>
          ) : pantone.status === "none" ? (
            <p className="text-ink-soft">{t("editor.pantone.none", { source: pantone.provider })}</p>
          ) : (
            <p className="text-ink-soft">{t("editor.pantone.unavailable")}</p>
          )}
        </section>
      </div>
    </div>
  );
}
