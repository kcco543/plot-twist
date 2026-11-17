"use client";

/**
 * MAP LAB — a sandbox for map generation that mirrors production exactly.
 * --------------------------------------------------------------------------
 * Every preview is made by `drawMap()` from lib/mapGenerator.ts, the same
 * function World Builder's "Generate Map" and new scenes from Play use:
 *   - Western Fantasy street / wilderness / ruins → the pixel map kit
 *     (lib/mapgen), with the same palette, renderer, scene kinds, checks and
 *     play area; the variation number is the kit's nonce.
 *   - everything else → /api/ai/map with the same prompt text (shown here
 *     from lib/ai/mapPrompt.ts, the very functions the server calls), the
 *     same model and output settings, and the same pixel-grid snapping.
 * The structured fields are only a way to write the description: they are
 * joined into the one text the pipeline receives, which is shown verbatim.
 * Previews stay in memory; "Use this map" stores one exactly as Generate Map does.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ActionBar, ScreenHeader } from "@/components/ScreenHeader";
import { Panel } from "@/components/ui/Panel";
import { PixelButton, PixelLink } from "@/components/ui/PixelButton";
import { ENVIRONMENT_TYPES } from "@/lib/environments";
import type { EnvironmentTypeId, WorldId } from "@/lib/types";
import { WORLDS } from "@/lib/worlds";
import { useSave } from "@/lib/gameStore";
import { useAiStatus } from "@/lib/ai/client";
import { mapPrompt } from "@/lib/ai/mapPrompt";
import { KIT_ID, kitSupports, sceneKindFor, biomeFor, type KitReport } from "@/lib/mapgen";
import { adoptMap, drawMap, type DrawnMap, type MapRequest } from "@/lib/mapGenerator";
import { readLayout, type SceneLayout } from "@/lib/scene/layout";
import { useI18n } from "@/i18n";

type Fields = { environment: string; architecture: string; mood: string; terrain: string; props: string };
const FIELD_KEYS = ["environment", "architecture", "mood", "terrain", "props"] as const;
const EMPTY: Fields = { environment: "", architecture: "", mood: "", terrain: "", props: "" };

/** The fields → the single description the pipeline receives (empty fields are left out). */
function composeDescription(f: Fields): string {
  return FIELD_KEYS.map((k) => f[k].trim())
    .filter(Boolean)
    .join(", ")
    .slice(0, 600);
}

/** The style-consistency test prompts (Western Fantasy). */
const BOARD: { type: EnvironmentTypeId; fields: Fields }[] = [
  { type: "street", fields: { environment: "village green", architecture: "timber-framed cottages", mood: "cozy morning", terrain: "pond", props: "old well, bench" } },
  { type: "wilderness", fields: { environment: "forest path", architecture: "", mood: "quiet, old woods", terrain: "mossy rocks", props: "stone shrine, fallen log" } },
  { type: "wilderness", fields: { environment: "riverbank", architecture: "mill cottage", mood: "peaceful", terrain: "river, wooden bridge", props: "bench, lamp post" } },
  { type: "ruins", fields: { environment: "temple ruins", architecture: "broken archway, columns", mood: "melancholy, overgrown", terrain: "cracked courtyard", props: "fallen column" } },
  { type: "street", fields: { environment: "desert oasis town", architecture: "adobe house, market stall", mood: "hot afternoon", terrain: "sand, oasis pond", props: "well, palms" } },
  { type: "wilderness", fields: { environment: "magical clearing", architecture: "", mood: "mysterious, glowing", terrain: "flagstone circle", props: "standing stones, shrine, mushrooms" } },
];

type Preview = { req: MapRequest; nonce: number; drawn: DrawnMap; url: string; scene: SceneLayout | null; at: number };

function usePreviewUrl(drawn: DrawnMap | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!drawn) return setUrl(null);
    const u = URL.createObjectURL(drawn.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [drawn]);
  return url;
}

/** The picture with the play area on top: walkable cells tinted, objects outlined. */
function PreviewImage({ url, scene, overlay, w, h }: { url: string; scene: SceneLayout | null; overlay: boolean; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const g = cv.getContext("2d")!;
    g.clearRect(0, 0, cv.width, cv.height);
    if (!overlay || !scene) return;
    const cw = cv.width / scene.cols;
    const ch = cv.height / scene.rows;
    g.fillStyle = "rgba(80, 220, 160, 0.32)";
    for (let r = 0; r < scene.rows; r++) for (let c = 0; c < scene.cols; c++) if (scene.floor[r * scene.cols + c] === "1") g.fillRect(c * cw, r * ch, cw, ch);
    g.lineWidth = 2;
    for (const o of scene.objects) {
      g.strokeStyle = o.solid ? "rgba(255, 90, 70, 0.95)" : "rgba(255, 220, 90, 0.95)";
      g.strokeRect(o.bounds.x0 * cv.width, o.bounds.y0 * cv.height, (o.bounds.x1 - o.bounds.x0) * cv.width, (o.bounds.y1 - o.bounds.y0) * cv.height);
    }
    g.fillStyle = "#fff";
    for (const s of scene.spawns) g.fillRect(s.x * cv.width - 3, s.y * cv.height - 3, 6, 6);
  }, [scene, overlay]);
  return (
    <div className="relative w-full" style={{ aspectRatio: `${w} / ${h}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" width={w} height={h} className="pixelated absolute inset-0 block size-full" data-lab-preview />
      <canvas ref={ref} width={w * 2} height={h * 2} className="pointer-events-none absolute inset-0 size-full" />
    </div>
  );
}

function Checks({ report }: { report: KitReport }) {
  const { t } = useI18n();
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const rows: [string, string][] = [
    [t("mapLab.walkable"), pct(report.walkable)],
    [t("mapLab.connected"), pct(report.connected)],
    [t("mapLab.visible"), pct(report.visibleGround)],
    [t("mapLab.front"), pct(report.frontCover)],
    [t("mapLab.colours"), String(report.colours)],
    [t("mapLab.objects"), String(report.objects)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3" data-lab-checks>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2 border-b border-dashed border-line py-0.5">
          <dt className="text-ink-mute">{k}</dt>
          <dd className="font-label text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function BoardCell({ c, nonce, onLoad }: { c: (typeof BOARD)[number]; nonce: number; onLoad: () => void }) {
  const { t, tx } = useI18n();
  const [drawn, setDrawn] = useState<DrawnMap | null>(null);
  const url = usePreviewUrl(drawn);
  const description = composeDescription(c.fields);
  useEffect(() => {
    let live = true;
    void drawMap({ worldId: "western-fantasy", type: c.type, description }, nonce).then((d) => live && setDrawn(d));
    return () => {
      live = false;
    };
  }, [description, c.type, nonce]);
  const kind = sceneKindFor(description, c.type);
  return (
    <figure className="flex flex-col gap-1.5" data-board-cell={kind}>
      {url && drawn ? <PreviewImage url={url} scene={drawn.scene ? readLayout(drawn.scene, drawn.width, drawn.height) : null} overlay={false} w={drawn.width} h={drawn.height} /> : <div className="aspect-[3/2] w-full animate-pulse bg-well" />}
      <figcaption className="flex items-start justify-between gap-2 text-sm">
        <span>
          <b className="font-label uppercase tracking-wide">{tx(`mapLab.kinds.${kind}`)}</b>
          <span className="block text-ink-mute">{description}</span>
          {drawn?.report && (
            <span className="block text-xs text-ink-mute">
              {t("mapLab.walkable")} {Math.round(drawn.report.walkable * 100)}% · {t("mapLab.visible")} {Math.round(drawn.report.visibleGround * 100)}%
            </span>
          )}
        </span>
        <PixelButton size="sm" variant="ghost" onClick={onLoad}>
          {t("mapLab.loadCase")}
        </PixelButton>
      </figcaption>
    </figure>
  );
}

export default function MapLabPage() {
  const { t, tx } = useI18n();
  const save = useSave();
  const status = useAiStatus();
  const [worldId, setWorldId] = useState<WorldId>(save.worldId ?? "western-fantasy");
  const [type, setType] = useState<EnvironmentTypeId>(save.environment.type === "interior" ? "street" : save.environment.type);
  const [fields, setFields] = useState<Fields>({ ...EMPTY, environment: save.environment.description.slice(0, 200) });
  const [nonce, setNonce] = useState(1);
  const [overlay, setOverlay] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [adopted, setAdopted] = useState(false);
  const [board, setBoard] = useState<number | null>(null);

  const description = composeDescription(fields);
  const kit = kitSupports(worldId, type);
  const canRun = description !== "" && (kit || !!status?.image);
  const prompt = useMemo(() => (kit ? null : mapPrompt({ description: description || "…", type, world: worldId })), [kit, description, type, worldId]);
  const kind = kit ? sceneKindFor(description, type) : null;
  const biome = kind ? biomeFor(description, kind) : null;

  const run = async (n = nonce) => {
    if (!canRun || busy) return;
    setBusy(true);
    setError(false);
    setAdopted(false);
    try {
      const req: MapRequest = { worldId, type, description };
      const drawn = await drawMap(req, n);
      const scene = drawn.scene ? readLayout(drawn.scene, drawn.width, drawn.height) : null;
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { req, nonce: n, drawn, url: URL.createObjectURL(drawn.blob), scene, at: Date.now() };
      });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const adopt = async () => {
    if (!preview) return;
    await adoptMap(preview.req, preview.drawn);
    setAdopted(true);
  };

  return (
    <main className="content-grid w-full flex-1 py-8 sm:py-10" data-map-lab>
      <ScreenHeader kicker={t("mapLab.kicker")} title={t("mapLab.heading")} />
      <p className="-mt-4 mb-8 max-w-[70ch] text-ink-soft">{t("mapLab.intro")}</p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel title={t("mapLab.form")}>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="font-label text-xs uppercase tracking-wide text-label">{t("mapLab.world")}</span>
                <select className="px-input min-h-11 bg-surface px-2" value={worldId} onChange={(e) => setWorldId(e.target.value as WorldId)} data-lab-world>
                  {WORLDS.map((w) => (
                    <option key={w.id} value={w.id}>
                      {tx(`worlds.list.${w.id}.name`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-label text-xs uppercase tracking-wide text-label">{t("mapLab.type")}</span>
                <select className="px-input min-h-11 bg-surface px-2" value={type} onChange={(e) => setType(e.target.value as EnvironmentTypeId)} data-lab-type>
                  {ENVIRONMENT_TYPES.map((e) => (
                    <option key={e} value={e}>
                      {tx(`environments.${e}.name`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {FIELD_KEYS.map((k) => (
              <label key={k} className="flex flex-col gap-1.5">
                <span className="font-label text-xs uppercase tracking-wide text-label">{tx(`mapLab.fields.${k}`)}</span>
                <input
                  className="px-input min-h-11 bg-surface px-2"
                  value={fields[k]}
                  maxLength={200}
                  placeholder={tx(`mapLab.placeholders.${k}`)}
                  onChange={(e) => setFields({ ...fields, [k]: e.target.value })}
                  data-lab-field={k}
                />
              </label>
            ))}
            <div>
              <p className="font-label text-xs uppercase tracking-wide text-label">{t("mapLab.sent")}</p>
              <p className="mt-1 min-h-12 whitespace-pre-wrap bg-well p-2 text-sm text-ink" data-lab-description>
                {description || "—"}
              </p>
              <p className="mt-1 text-xs text-ink-mute">{t("mapLab.sentHint")}</p>
            </div>
            {kit && (
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="font-label text-xs uppercase tracking-wide text-label">{t("mapLab.variation")}</span>
                  <input type="number" min={0} className="px-input min-h-11 w-28 bg-surface px-2" value={nonce} onChange={(e) => setNonce(Math.max(0, Math.floor(Number(e.target.value) || 0)))} data-lab-nonce />
                </label>
                <PixelButton
                  variant="ghost"
                  disabled={!canRun || busy}
                  onClick={() => {
                    const n = nonce + 1;
                    setNonce(n);
                    void run(n);
                  }}
                >
                  {t("mapLab.newVariation")}
                </PixelButton>
              </div>
            )}
            {!kit && <p className="text-sm text-ink-mute">{status?.image ? t("mapLab.aiConfirm") : t("mapLab.aiOff")}</p>}
            <PixelButton variant="primary" loading={busy} disabled={!canRun} onClick={() => void run()} data-lab-generate>
              {busy ? t("mapLab.generating") : t("mapLab.generate")}
            </PixelButton>
          </div>
        </Panel>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel title={t("mapLab.pipeline")}>
            <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]" data-lab-pipeline={kit ? "kit" : "ai"}>
              <dt className="text-ink-mute">{t("mapLab.pipeline")}</dt>
              <dd>
                <b>{kit ? t("mapLab.kit") : t("mapLab.ai")}</b> <span className="text-ink-mute">— {kit ? t("mapLab.kitWhy") : t("mapLab.aiWhy")}</span>
              </dd>
              <dt className="text-ink-mute">{t("mapLab.model")}</dt>
              <dd className="font-label">{kit ? KIT_ID : (status?.imageModel ?? "—")}</dd>
              {kind && biome && (
                <>
                  <dt className="text-ink-mute">{t("mapLab.kind")}</dt>
                  <dd data-lab-kind={kind}>
                    {tx(`mapLab.kinds.${kind}`)} · {tx(`mapLab.biomes.${biome}`)}
                  </dd>
                </>
              )}
              {preview?.drawn.report && (
                <>
                  <dt className="text-ink-mute">{t("mapLab.seed")}</dt>
                  <dd className="font-label">
                    {preview.drawn.report.seed} · {t("mapLab.variation")} {preview.drawn.report.nonce} · {t("mapLab.attempts")} {preview.drawn.report.attempts}
                  </dd>
                </>
              )}
            </dl>
            {prompt && (
              <details className="mt-3">
                <summary className="cursor-pointer font-label text-xs uppercase tracking-wide text-label">{t("mapLab.prompt")}</summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap bg-well p-2 text-xs text-ink" data-lab-prompt>
                  {prompt}
                </pre>
              </details>
            )}
          </Panel>

          <Panel
            title={t("mapLab.generate")}
            titleRight={
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} data-lab-overlay /> {t("mapLab.overlay")}
              </label>
            }
          >
            {preview ? (
              <div className="flex flex-col gap-3">
                <PreviewImage url={preview.url} scene={preview.scene} overlay={overlay} w={preview.drawn.width} h={preview.drawn.height} />
                {preview.drawn.report && <Checks report={preview.drawn.report} />}
                <div className="flex flex-wrap items-center gap-3">
                  <PixelButton variant="secondary" disabled={adopted || preview.req.worldId !== save.worldId} onClick={() => void adopt()} data-lab-use>
                    {t("mapLab.use")}
                  </PixelButton>
                  {adopted && <span className="text-sm text-ink-soft">{t("mapLab.used")}</span>}
                  {preview.req.worldId !== save.worldId && <span className="text-sm text-ink-mute">{t("mapLab.useOtherWorld")}</span>}
                </div>
              </div>
            ) : (
              <p className="text-ink-mute">{error ? t("mapLab.failed") : t("mapLab.empty")}</p>
            )}
            {error && preview && <p className="mt-2 text-sm text-coral-deep">{t("mapLab.failed")}</p>}
          </Panel>
        </div>
      </div>

      <Panel className="mt-8" title={t("mapLab.board")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[70ch] text-sm text-ink-soft">{t("mapLab.boardHint")}</p>
          <PixelButton variant="primary" onClick={() => setBoard(nonce)} data-lab-board>
            {t("mapLab.runBoard")}
          </PixelButton>
        </div>
        {board !== null && (
          <div className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3" data-lab-board-grid>
            {BOARD.map((c, i) => (
              <BoardCell
                key={`${i}-${board}`}
                c={c}
                nonce={board}
                onLoad={() => {
                  setWorldId("western-fantasy");
                  setType(c.type);
                  setFields(c.fields);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            ))}
          </div>
        )}
      </Panel>

      <ActionBar>
        <PixelLink href="/builder" icon="left">
          {t("builder.heading")}
        </PixelLink>
      </ActionBar>
    </main>
  );
}
