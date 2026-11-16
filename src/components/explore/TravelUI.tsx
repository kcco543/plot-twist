"use client";

/**
 * Leaving an area: the confirmation, the fade to black, and choosing (or
 * creating) where the exit leads. All in the game's own pixel windows (the
 * world's skin applies through the shared Modal / PixelButton tokens).
 */
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { LoadingDots } from "@/components/ui/LoadingDots";
import { useI18n } from "@/i18n";
import type { EnvironmentTypeId } from "@/lib/types";
import type { SceneRecord } from "@/lib/explore/scenes";

const ENV_TYPES: EnvironmentTypeId[] = ["interior", "street", "wilderness", "ruins", "dreamscape"];

/** "Leave This Area?" — Stay Here / Leave, and who goes along. */
export function LeaveAreaDialog({
  open,
  body,
  party,
  chosen,
  onToggle,
  onStay,
  onLeave,
}: {
  open: boolean;
  body: string;
  /** Characters in this area who could come along (the one at the exit first, always going). */
  party: { id: string; name: string; fixed: boolean }[];
  chosen: string[];
  onToggle: (id: string) => void;
  onStay: () => void;
  onLeave: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      onClose={onStay}
      title={t("explore.leave.title")}
      closeLabel={t("explore.leave.stay")}
      size="sm"
      footer={
        <>
          <PixelButton variant="secondary" onClick={onStay} data-leave-stay>
            {t("explore.leave.stay")}
          </PixelButton>
          <PixelButton variant="primary" icon="right" onClick={onLeave} data-leave-go data-autofocus>
            {t("explore.leave.leave")}
          </PixelButton>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-leave-dialog>
        <p className="text-lg leading-snug">{body}</p>
        {party.length > 1 && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 font-label text-[10px] uppercase text-label">{t("explore.leave.party")}</legend>
            {party.map((p) => (
              <label key={p.id} className={`flex min-h-10 items-center gap-2 bg-well px-2 text-base ${p.fixed ? "opacity-80" : ""}`}>
                <input type="checkbox" className="size-5" checked={chosen.includes(p.id)} disabled={p.fixed} onChange={() => onToggle(p.id)} data-leave-party={p.id} />
                {p.name}
              </label>
            ))}
            <span className="text-sm text-ink-soft">{t("explore.leave.partyHint")}</span>
          </fieldset>
        )}
        <p className="text-sm text-ink-mute">{t("explore.leave.saved")}</p>
      </div>
    </Modal>
  );
}

/**
 * Fade to black over the play area. Opacity only (no flashing), short, and
 * instant with reduced motion. While it's up, the stage is paused and input
 * is blocked by the play screen. `children` shows on the black (loading text).
 */
export function FadeCurtain({ shown, reducedMotion, children }: { shown: boolean; reducedMotion: boolean; children?: React.ReactNode }) {
  const [mounted, setMounted] = useState(shown);
  useEffect(() => {
    if (shown) setMounted(true);
    else {
      const id = window.setTimeout(() => setMounted(false), reducedMotion ? 0 : 420);
      return () => window.clearTimeout(id);
    }
  }, [shown, reducedMotion]);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!mounted) return setVisible(false);
    const id = requestAnimationFrame(() => setVisible(shown));
    return () => cancelAnimationFrame(id);
  }, [mounted, shown]);
  if (!mounted) return null;
  return (
    <div
      aria-hidden={!shown}
      data-fade-curtain={shown ? "in" : "out"}
      className="fixed inset-0 z-[45] grid place-items-center bg-[#0b0910]"
      style={{ opacity: visible ? 1 : 0, transition: reducedMotion ? "none" : "opacity 380ms ease-in-out", pointerEvents: shown ? "auto" : "none" }}
    >
      {children}
    </div>
  );
}

/** Loading / status text on the black screen. */
export function CurtainStatus({ text, busy }: { text: string; busy?: boolean }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 px-6 text-center font-head text-lg font-bold text-white/90">
      {busy && <LoadingDots />}
      <span>{text}</span>
    </div>
  );
}

export type NewSceneDraft = { name: string; description: string; envType: EnvironmentTypeId };

/** Next-scene selection: create a new scene, or pick one of this world's scenes. */
export function ScenePicker({
  open,
  worldName,
  scenes,
  currentId,
  connectedIds,
  sceneName,
  thumbOf,
  presentCount,
  canGenerate,
  generating,
  error,
  defaultType,
  twoWayDefault,
  full,
  onCreate,
  onChoose,
  onCancel,
}: {
  open: boolean;
  worldName: string;
  scenes: SceneRecord[];
  currentId: string;
  /** Scenes already connected to the current one. */
  connectedIds: string[];
  sceneName: (s: SceneRecord) => string;
  thumbOf: (s: SceneRecord) => string;
  presentCount: (s: SceneRecord) => number;
  /** Map generation is configured (and allowed by the AI mode); false = placeholder only. */
  canGenerate: boolean;
  generating: boolean;
  error: string | null;
  defaultType: EnvironmentTypeId;
  twoWayDefault: boolean;
  full: boolean;
  onCreate: (d: NewSceneDraft, how: "generate" | "placeholder", twoWay: boolean) => void;
  onChoose: (sceneId: string, twoWay: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const others = scenes.filter((s) => s.id !== currentId);
  const [tab, setTab] = useState<"new" | "existing">(others.length ? "existing" : "new");
  const [draft, setDraft] = useState<NewSceneDraft>({ name: "", description: "", envType: defaultType });
  const [twoWay, setTwoWay] = useState(twoWayDefault);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTab(others.length ? "existing" : "new");
    setDraft({ name: "", description: "", envType: defaultType });
    setTwoWay(twoWayDefault);
    setTried(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const needsText = tried && !draft.description.trim();

  return (
    <Modal open={open} onClose={() => !generating && onCancel()} title={t("explore.picker.title")} closeLabel={t("explore.picker.cancel")} size="lg">
      <div className="flex flex-col gap-3" data-scene-picker>
        <p className="text-base text-ink-soft">{t("explore.picker.intro")}</p>
        <div role="tablist" className="flex gap-1.5">
          {(["existing", "new"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              disabled={generating}
              onClick={() => setTab(k)}
              className={`px-focus min-h-11 flex-1 px-2 font-head text-base font-bold ${tab === k ? "bg-butter text-ink shadow-[inset_0_-3px_0_var(--color-butter-lo)]" : "bg-well text-ink-soft"}`}
              data-picker-tab={k}
            >
              {t(k === "new" ? "explore.picker.tabNew" : "explore.picker.tabExisting")}
            </button>
          ))}
        </div>

        {tab === "existing" ? (
          others.length === 0 ? (
            <p className="bg-well px-3 py-4 text-center text-base text-ink-soft">{t("explore.picker.noScenes")}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {others.map((s) => {
                const linked = connectedIds.includes(s.id);
                const n = presentCount(s);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => onChoose(s.id, twoWay)}
                      className="px-focus flex w-full gap-2 bg-well p-1.5 text-left hover:bg-butter-hi"
                      style={{ boxShadow: "inset 0 0 0 2px var(--color-line)" }}
                      data-pick-scene={s.id}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbOf(s)} alt="" className="pixelated aspect-[5/3] w-24 shrink-0 object-cover" />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate font-head text-base font-bold">{sceneName(s)}</span>
                        <span className="line-clamp-2 text-sm leading-snug text-ink-soft">{s.description || t(`environments.${s.envType}.name`)}</span>
                        <span className="mt-auto flex flex-wrap gap-1 font-label text-[9px] uppercase">
                          <span className={linked ? "bg-mint-hi px-1 text-mint-deep" : "bg-surface px-1 text-ink-mute"}>{t(linked ? "explore.picker.connected" : "explore.picker.notConnected")}</span>
                          <span className="bg-surface px-1 text-ink-mute">{n ? t("explore.picker.here", { n: String(n) }) : t("explore.picker.nobody")}</span>
                          {s.placeholder && <span className="bg-butter-hi px-1 text-ink">{t("explore.picker.placeholderTag")}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : (
          <div className="flex flex-col gap-2.5">
            {full && <p className="bg-peach-hi px-2 py-1.5 text-sm text-coral-deep">{t("explore.picker.full")}</p>}
            <label className="flex flex-col gap-1">
              <span className="font-label text-[10px] uppercase text-label">{t("explore.picker.name")}</span>
              <input value={draft.name} maxLength={40} disabled={generating} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("explore.picker.namePlaceholder")} className="px-input min-h-11 px-2" data-new-scene-name />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-label text-[10px] uppercase text-label">{t("explore.picker.description")}</span>
              <textarea value={draft.description} maxLength={1000} rows={3} disabled={generating} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder={t("explore.picker.descriptionPlaceholder")} className="px-input px-2 py-1.5" data-new-scene-description />
              {needsText && <span className="text-sm text-coral-deep">{t("explore.picker.needsDescription")}</span>}
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-label text-[10px] uppercase text-label">{t("explore.picker.type")}</span>
              <select value={draft.envType} disabled={generating} onChange={(e) => setDraft({ ...draft, envType: e.target.value as EnvironmentTypeId })} className="px-input min-h-11 px-2" data-new-scene-type>
                {ENV_TYPES.map((k) => (
                  <option key={k} value={k}>
                    {t(`environments.${k}.name`)}
                  </option>
                ))}
              </select>
            </label>
            <p className="flex items-start gap-1.5 text-sm text-ink-soft">
              <PixelIcon name="sparkle" size={10} className="mt-1 shrink-0 text-label" />
              {t("explore.picker.theme", { world: worldName })}
            </p>
            {!canGenerate && <p className="bg-butter-hi px-2 py-1.5 text-sm text-ink">{t("explore.picker.noImage")}</p>}
            {generating && (
              <p role="status" className="flex items-center gap-2 bg-lavender-hi px-2 py-2 text-base">
                <LoadingDots />
                {t("explore.picker.generating")}
              </p>
            )}
            {error && !generating && (
              <p role="alert" className="bg-peach-hi px-2 py-1.5 text-sm text-coral-deep" data-scene-gen-error>
                {t("explore.picker.failed", { reason: error })}
              </p>
            )}
            <p className="text-sm text-ink-mute">{t("explore.picker.placeholderNote")}</p>
          </div>
        )}

        <label className="flex items-center gap-2 text-base">
          <input type="checkbox" className="size-5" checked={twoWay} disabled={generating} onChange={(e) => setTwoWay(e.target.checked)} data-picker-two-way />
          {t("explore.picker.twoWay")}
        </label>

        <div className="flex flex-wrap justify-end gap-2 border-t-[3px] border-dashed border-line pt-3">
          <PixelButton variant="ghost" onClick={onCancel} disabled={generating} data-picker-cancel>
            {t("explore.picker.cancel")}
          </PixelButton>
          {tab === "new" && (
            <>
              <PixelButton
                variant="secondary"
                disabled={generating || full}
                onClick={() => {
                  setTried(true);
                  if (draft.description.trim() || draft.name.trim()) onCreate(draft, "placeholder", twoWay);
                }}
                data-create-placeholder
              >
                {t("explore.picker.usePlaceholder")}
              </PixelButton>
              {canGenerate && (
                <PixelButton
                  variant="magic"
                  icon="sparkle"
                  loading={generating}
                  disabled={full}
                  onClick={() => {
                    setTried(true);
                    if (draft.description.trim()) onCreate(draft, "generate", twoWay);
                  }}
                  data-create-generate
                >
                  {error ? t("explore.picker.retry") : t("explore.picker.generate")}
                </PixelButton>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** The scene's name, shown briefly on arrival. */
export function SceneTitleCard({ title, subtitle, k }: { title: string; subtitle: string; k: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!k) return;
    setShow(true);
    const id = window.setTimeout(() => setShow(false), 2400);
    return () => window.clearTimeout(id);
  }, [k]);
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center" aria-live="polite" data-scene-title>
      <div className="animate-pop px-frame px-panel px-4 py-1.5 text-center" style={{ "--frame": "var(--frame-panel)" } as React.CSSProperties}>
        <p className="font-label text-[10px] uppercase text-label">{subtitle}</p>
        <p className="font-head text-xl font-bold">{title}</p>
      </div>
    </div>
  );
}
