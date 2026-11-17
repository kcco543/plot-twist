/**
 * GUIDED MAP ART — make the one evaluation test scene (PIXEL_ART_STYLE_GUIDE.md §18).
 *
 *   npx -y tsx scripts/guided-test-scene.ts [--description "..."] [--type street] [--nonce 1] [--base http://localhost:3000]
 *
 * Runs the same steps as Map Lab → Guided art (drawGuidedMap), outside the
 * browser: the kit plans the place, its block-out goes to the running dev
 * server's /api/ai/map/guided (ONE image-service call, never retried), and the answer is
 * snapped onto the 480×320 grid and checked against the plan. Writes
 * public/map-trial/test-scene*.{png,json}; Map Lab → "Show the saved test
 * scene" opens it, and "Use this map in my world" makes it playable.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import en from "../src/i18n/locales/en.json";
import { checkAlignment, generateKitMap, guideFromPlan, type LabelKey } from "../src/lib/mapgen";
import { enlarge, snapMapToGrid } from "../src/lib/pixelArt/mapPixels";
import { decodePng, encodePng } from "./lib/png";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const description = arg("description", "village square, timber-framed cottages with character, cozy late afternoon, cobblestone plaza and a worn dirt road, old stone well, bench");
const type = arg("type", "street") as "street" | "wilderness" | "ruins";
const nonce = Number(arg("nonce", "1"));
const base = arg("base", "http://localhost:3000");
const out = arg("out", "public/map-trial");

const labels = (en as unknown as { mapKit: { labels: Record<string, string> } }).mapKit.labels;
const label = (k: LabelKey) => labels[k] ?? k;

async function main() {
  const kit = generateKitMap({ description, type, nonce, label });
  const { guide, classes } = guideFromPlan(kit.plan.bp, kit.plan.props);
  const form = new FormData();
  form.set("image", new Blob([new Uint8Array(encodePng(enlarge(guide, 1536, 1024)))], { type: "image/png" }), "layout.png");
  form.set("description", description);
  form.set("type", type);
  form.set("world", "western-fantasy");
  console.log(`Plan: ${kit.report.kind} · seed ${kit.report.seed} · walkable ${Math.round(kit.report.walkable * 100)}%. Asking the image service…`);
  const res = await fetch(`${base}/api/ai/map/guided`, { method: "POST", body: form });
  const body = (await res.json()) as { image?: string; model?: string; provider?: string; usage?: unknown; error?: string; message?: string };
  if (!res.ok || !body.image) throw new Error(`Image service: ${res.status} ${body.error ?? ""} ${body.message ?? ""}`);
  const rawBytes = Buffer.from(body.image.split(",")[1], "base64");
  const art = snapMapToGrid(decodePng(rawBytes), { width: guide.w, height: guide.h });
  const alignment = checkAlignment(art, classes, kit.scene);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "test-scene-raw.png"), rawBytes);
  writeFileSync(join(out, "test-scene.png"), encodePng(art));
  writeFileSync(join(out, "test-scene-guide.png"), encodePng(guide));
  writeFileSync(join(out, "test-scene-kit.png"), encodePng(kit.img));
  const meta = {
    req: { worldId: "western-fantasy", type, description },
    nonce,
    width: art.w,
    height: art.h,
    model: `guided/${body.model}#${kit.report.seed}`,
    provider: body.provider,
    report: kit.report,
    alignment,
    usage: body.usage ?? null,
    scene: kit.scene,
    madeAt: new Date().toISOString(),
  };
  writeFileSync(join(out, "test-scene.json"), JSON.stringify(meta));
  console.log(`Usage reported by the image service: ${JSON.stringify(body.usage ?? null)}`);
  console.log(`Done (${body.model}). Floor still clear ${Math.round(alignment.floorClear * 100)}%, objects in place ${Math.round(alignment.solidsPresent * 100)}%. Files in ${out}/`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
