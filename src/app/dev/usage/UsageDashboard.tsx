"use client";

/**
 * API Usage dashboard (development only). Reads /api/dev/usage, which only
 * reports numbers the server already counted; opening this page never calls
 * Anthropic. It refreshes every few seconds while the tab is visible.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PixelButton } from "@/components/ui/PixelButton";

type Mode = "offline" | "balanced" | "full";
type Totals = { requests: number; ok: number; failed: number; blocked: number; deduped: number; inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number; costUsd: number; ms: number; models: string[] };
type Rec = { at: number; feature: string; model: string; ok: boolean; error?: string; inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number; costUsd: number; ms: number };
type Limits = { perMinute: number; concurrent: number; maxOutputTokens: number; sessionBudgetUsd: number };
type Data = {
  mode: Mode;
  limits: Limits;
  startedAt: number;
  spentUsd: number;
  budgetLeftUsd: number;
  requestsLastMinute: number;
  inFlight: number;
  totals: Record<string, Totals>;
  blockedReasons: Record<string, number>;
  recent: Rec[];
  models: Record<string, string>;
  keyConfigured: boolean;
};

const FEATURE_LABEL: Record<string, string> = {
  talk: "Conversations (walk & talk)",
  turn: "Story beat wording",
  photo: "Photo reactions",
  gift_reaction: "Gift reactions",
  analyze: "Personality analysis",
  refine: "Profile refinement",
};
const MODE_INFO: Record<Mode, { label: string; text: string }> = {
  offline: { label: "Offline", text: "No Anthropic requests. Characters use built-in lines and saved data." },
  balanced: { label: "Balanced", text: "AI only for what you start: conversations, photos, gifts, analysis, and Talk / event beats. Observe and Wait use built-in lines." },
  full: { label: "Full AI", text: "AI also words Observe and Wait beats. Same limits and budget." },
};
const BLOCK_LABEL: Record<string, string> = { offline: "Offline mode", mode: "Off in this mode", budget: "Budget used up", per_minute: "Per-minute limit", concurrent: "Too many at once" };

const usd = (n: number) => (n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const int = (n: number) => n.toLocaleString("en-US");

export function UsageDashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState<Limits | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/dev/usage", { cache: "no-store" });
      if (!r.ok) throw new Error();
      setData(await r.json());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 4000);
    return () => window.clearInterval(id);
  }, [load]);

  const post = async (body: object) => {
    setSaving(true);
    try {
      const r = await fetch("/api/dev/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) setData(await r.json());
    } finally {
      setSaving(false);
    }
  };

  if (!data) return <main className="mx-auto max-w-5xl p-4 text-base">{error ? "Couldn't load usage data." : "Loading…"}</main>;

  const rows = Object.entries(data.totals);
  const all = rows.reduce(
    (a, [, t]) => ({ requests: a.requests + t.requests, failed: a.failed + t.failed, blocked: a.blocked + t.blocked, deduped: a.deduped + t.deduped, cost: a.cost + t.costUsd }),
    { requests: 0, failed: 0, blocked: 0, deduped: 0, cost: 0 },
  );
  const limits = draft ?? data.limits;
  const pct = Math.min(100, (data.spentUsd / data.limits.sessionBudgetUsd) * 100);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 text-base leading-snug">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl">API Usage</h1>
          <p className="text-sm text-ink-soft">Development only. Counts every Anthropic request this server made since {new Date(data.startedAt).toLocaleTimeString()}. No keys, prompts or replies are stored.</p>
        </div>
        <Link href="/" className="text-sm underline">
          Back to the game
        </Link>
      </header>

      {!data.keyConfigured && <p className="bg-well px-3 py-2 text-sm">No Anthropic key is set on this server, so no requests can be made.</p>}

      <section className="bg-surface flex flex-col gap-3 p-4 shadow-sm">
        <h2 className="font-label text-xs uppercase tracking-wide text-label">AI mode</h2>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="AI mode">
          {(Object.keys(MODE_INFO) as Mode[]).map((m) => (
            <PixelButton key={m} size="sm" variant={data.mode === m ? "primary" : "ghost"} aria-checked={data.mode === m} role="radio" disabled={saving} onClick={() => post({ mode: m })}>
              {MODE_INFO[m].label}
              {m === "balanced" ? " (default)" : ""}
            </PixelButton>
          ))}
        </div>
        <p className="text-sm text-ink-soft">{MODE_INFO[data.mode].text} Reload the game tab after switching.</p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Estimated spend", usd(data.spentUsd)],
          ["Requests sent", int(all.requests)],
          ["Saved by de-duplication", int(all.deduped)],
          ["Blocked by limits / mode", int(all.blocked)],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface p-3 shadow-sm">
            <p className="text-xs text-ink-soft">{k}</p>
            <p className="font-display text-lg tabular-nums">{v}</p>
          </div>
        ))}
      </section>

      <section className="bg-surface flex flex-col gap-2 p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-label text-xs uppercase tracking-wide text-label">Session budget</h2>
          <span className="text-sm tabular-nums">
            {usd(data.spentUsd)} of {usd(data.limits.sessionBudgetUsd)} · {data.requestsLastMinute}/{data.limits.perMinute} this minute · {data.inFlight} running
          </span>
        </div>
        <div className="h-2 w-full bg-well" aria-hidden>
          <div className={pct >= 100 ? "h-2 bg-coral-deep" : "h-2 bg-mint-deep"} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-ink-soft">This is the app&apos;s own estimate from token counts and list prices. It is not a billing cap: set a spend limit in the Anthropic Console for that.</p>
      </section>

      <section className="bg-surface overflow-x-auto p-4 shadow-sm">
        <h2 className="mb-2 font-label text-xs uppercase tracking-wide text-label">By feature</h2>
        <table className="w-full min-w-[720px] text-left text-sm tabular-nums">
          <thead className="text-ink-soft">
            <tr>
              <th className="py-1 pr-3 font-normal">Feature</th>
              <th className="pr-3 font-normal">Model</th>
              <th className="pr-3 text-right font-normal">Requests</th>
              <th className="pr-3 text-right font-normal">OK / failed</th>
              <th className="pr-3 text-right font-normal">Input</th>
              <th className="pr-3 text-right font-normal">Output</th>
              <th className="pr-3 text-right font-normal">Cache write / read</th>
              <th className="pr-3 text-right font-normal">Avg time</th>
              <th className="text-right font-normal">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([f, t]) => (
              <tr key={f} className="border-t border-well">
                <td className="py-1.5 pr-3">{FEATURE_LABEL[f] ?? f}</td>
                <td className="pr-3">{t.models.length ? t.models.join(", ") : data.models[f]}</td>
                <td className="pr-3 text-right">
                  {int(t.requests)}
                  {t.deduped ? <span className="text-ink-soft"> (+{t.deduped} reused)</span> : null}
                  {t.blocked ? <span className="text-coral-deep"> ({t.blocked} blocked)</span> : null}
                </td>
                <td className="pr-3 text-right">
                  {t.ok} / {t.failed}
                </td>
                <td className="pr-3 text-right">{int(t.inputTokens)}</td>
                <td className="pr-3 text-right">{int(t.outputTokens)}</td>
                <td className="pr-3 text-right">
                  {int(t.cacheWriteTokens)} / {int(t.cacheReadTokens)}
                </td>
                <td className="pr-3 text-right">{t.requests ? `${(t.ms / t.requests / 1000).toFixed(1)}s` : "–"}</td>
                <td className="text-right">{usd(t.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {Object.keys(data.blockedReasons).length > 0 && (
          <p className="mt-2 text-xs text-ink-soft">
            Blocked: {Object.entries(data.blockedReasons).map(([k, v]) => `${BLOCK_LABEL[k] ?? k} ×${v}`).join(", ")}
          </p>
        )}
      </section>

      <section className="bg-surface flex flex-col gap-3 p-4 shadow-sm">
        <h2 className="font-label text-xs uppercase tracking-wide text-label">Limits</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(
            [
              ["perMinute", "Max requests per minute", 1],
              ["concurrent", "Max requests at once", 1],
              ["maxOutputTokens", "Max output tokens per request", 256],
              ["sessionBudgetUsd", "Max estimated spend this session (USD)", 0.01],
            ] as const
          ).map(([k, label, step]) => (
            <label key={k} className="flex flex-col gap-1 text-sm">
              <span>{label}</span>
              <input
                type="number"
                min={step}
                step={step}
                value={limits[k]}
                onChange={(e) => setDraft({ ...limits, [k]: Number(e.target.value) })}
                className="border-2 border-well bg-white px-2 py-1 tabular-nums"
              />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <PixelButton size="sm" variant="primary" disabled={!draft || saving} onClick={() => post({ limits: draft }).then(() => setDraft(null))}>
            Save limits
          </PixelButton>
          <PixelButton size="sm" variant="ghost" disabled={saving} onClick={() => post({ reset: true })}>
            Start a new session (reset counts and budget)
          </PixelButton>
        </div>
      </section>

      <section className="bg-surface overflow-x-auto p-4 shadow-sm">
        <h2 className="mb-2 font-label text-xs uppercase tracking-wide text-label">Recent requests</h2>
        {data.recent.length === 0 ? (
          <p className="text-sm text-ink-soft">None yet. Idle screens, walking and character autonomy never call the API.</p>
        ) : (
          <table className="w-full min-w-[640px] text-left text-sm tabular-nums">
            <tbody>
              {data.recent.map((r, i) => (
                <tr key={i} className="border-t border-well">
                  <td className="py-1 pr-3">{new Date(r.at).toLocaleTimeString()}</td>
                  <td className="pr-3">{FEATURE_LABEL[r.feature] ?? r.feature}</td>
                  <td className="pr-3">{r.model}</td>
                  <td className="pr-3">{r.ok ? "ok" : <span className="text-coral-deep">{r.error}</span>}</td>
                  <td className="pr-3 text-right">
                    {int(r.inputTokens)} in · {int(r.outputTokens)} out · {int(r.cacheReadTokens)} cached
                  </td>
                  <td className="pr-3 text-right">{(r.ms / 1000).toFixed(1)}s</td>
                  <td className="text-right">{usd(r.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
