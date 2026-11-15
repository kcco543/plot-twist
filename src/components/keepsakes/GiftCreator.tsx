"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PixelButton, buttonStyle } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { Field } from "@/components/ui/Field";
import { PixelCanvasEditor } from "@/components/game/PixelEditor";
import { AiRequestError, requestGiftImage, useAiStatus } from "@/lib/ai/client";
import { dataURLToImg, imgToDataURL } from "@/lib/sprites/canvas";
import type { Img } from "@/lib/sprites/pixelize";
import { blankGift, isEmptyArt, makeItem } from "@/lib/keepsakes/giftArt";
import { listGifts, saveGift, subscribeKeepsakes } from "@/lib/keepsakes/store";
import { GIFT_RETRYABLE } from "@/lib/gifts/request";
import type { GiveResult } from "./useGiftMoment";
import { GIFT_DESCRIPTION_MAX, GIFT_NAME_MAX, GIFT_SIZE, type GiftKeepsake } from "@/lib/keepsakes/types";
import { useI18n } from "@/i18n";

type ArtMode = "draw" | "ai";

/**
 * Gift Creator: name and describe a gift, draw it in the pixel editor (the
 * same editor as the Sprite Studio) or generate a picture with AI when an
 * image service is configured, see it as an item, then Save Gift (to this
 * world's gift box) and / or Give Gift to the character. Giving asks the AI
 * for the character's reaction (the gift's name, description and picture go
 * to Claude); on success the page plays it on the stage and closes this.
 */
export function GiftCreator({
  open,
  worldId,
  world,
  characterId,
  name,
  ai: aiMode,
  onClose,
  onGive,
}: {
  open: boolean;
  /** Active world save id. */
  worldId: string | null;
  /** World theme (art direction for AI pictures). */
  world: string | null;
  characterId: string;
  name: string;
  /** Reactions: real AI, developer TEST replies, or off. */
  ai: "ai" | "mock" | null;
  onClose: () => void;
  /** Give the saved gift; the page validates, asks for the reaction and closes this on success. */
  onGive: (gift: GiftKeepsake, signal: AbortSignal) => Promise<GiveResult>;
}) {
  const { t } = useI18n();
  const ai = useAiStatus();
  const [giftName, setGiftName] = useState("");
  const [description, setDescription] = useState("");
  const [img, setImg] = useState<Img>(blankGift);
  const [art, setArt] = useState<"drawn" | "ai" | null>(null);
  const [mode, setMode] = useState<ArtMode>("draw");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"ai" | "save" | "give" | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [giveError, setGiveError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const giving = useRef<AbortController | null>(null);
  const [box, setBox] = useState<GiftKeepsake[]>([]);

  // Fresh creator each time it opens.
  useEffect(() => {
    if (!open) return;
    setGiftName("");
    setDescription("");
    setImg(blankGift());
    setArt(null);
    setMode("draw");
    setSavedId(null);
    setDirty(false);
    setBusy(null);
    setAiError(null);
    setProblem(null);
    setNotice(null);
    setGiveError(null);
    setCanRetry(false);
    return () => {
      giving.current?.abort();
      giving.current = null;
    };
  }, [open, characterId]);

  // This world's gift box (saved gifts), kept up to date.
  useEffect(() => {
    if (!open || !worldId) return setBox([]);
    let live = true;
    const load = () => void listGifts(worldId).then((g) => live && setBox(g));
    load();
    const off = subscribeKeepsakes(load);
    return () => {
      live = false;
      off();
    };
  }, [open, worldId]);

  const empty = useMemo(() => isEmptyArt(img), [img]);
  const preview = useMemo(() => (empty ? null : imgToDataURL(img)), [img, empty]);
  const named = giftName.trim().length > 0;
  const imageReady = ai?.image === true;

  const edit = (next: Img) => {
    setImg(next);
    setArt("drawn");
    setDirty(true);
    setNotice(null);
  };

  const generate = async () => {
    if (!named) return setAiError(t("keepsakes.gift.needName"));
    setBusy("ai");
    setAiError(null);
    try {
      const out = await requestGiftImage({ name: giftName.trim(), description: description.trim(), world });
      const item = makeItem(await dataURLToImg(out.image, 256));
      if (!item) throw new AiRequestError("invalid_output", "empty picture");
      setImg(item);
      setArt("ai");
      setDirty(true);
      setNotice(null);
    } catch (err) {
      const code = err instanceof AiRequestError ? err.code : "failed";
      setAiError(t(`keepsakes.gift.aiError.${code === "not_configured" || code === "offline" || code === "rate_limited" || code === "refused" ? code : "failed"}`));
    } finally {
      setBusy(null);
    }
  };

  const store = async (): Promise<GiftKeepsake | null> => {
    if (!named) {
      setProblem(t("keepsakes.gift.needName"));
      return null;
    }
    if (!worldId) {
      setProblem(t("keepsakes.saveFailed"));
      return null;
    }
    setProblem(null);
    const g = await saveGift(worldId, { id: savedId ?? undefined, name: giftName.slice(0, GIFT_NAME_MAX), description: description.slice(0, GIFT_DESCRIPTION_MAX), image: preview, art: preview ? (art ?? "drawn") : null });
    setSavedId(g.id);
    setDirty(false);
    return g;
  };

  const onSave = async () => {
    setBusy("save");
    try {
      const g = await store();
      if (g) setNotice(t("keepsakes.gift.saved", { gift: g.name }));
    } catch {
      setProblem(t("keepsakes.saveFailed"));
    } finally {
      setBusy(null);
    }
  };

  const give = async () => {
    if (!aiMode) return;
    setBusy("give");
    setGiveError(null);
    setCanRetry(false);
    const ctrl = new AbortController();
    giving.current = ctrl;
    try {
      const g = savedId && !dirty ? box.find((x) => x.id === savedId) ?? (await store()) : await store();
      if (!g || !worldId) return;
      const r = await onGive(g, ctrl.signal);
      if (giving.current !== ctrl || r.ok) return; // stopped, or the page took over
      if (r.code === "cancelled") return;
      if (r.code === "transfer") setGiveError(t(`keepsakes.gift.transfer.${r.problem}`, { name }));
      else {
        setGiveError(t(`keepsakes.gift.error.${r.code}`, { name }));
        setCanRetry(GIFT_RETRYABLE.has(r.code));
      }
    } catch {
      setProblem(t("keepsakes.saveFailed"));
    } finally {
      if (giving.current === ctrl) giving.current = null;
      setBusy(null);
    }
  };
  const stopGiving = () => {
    giving.current?.abort();
    giving.current = null;
    setBusy(null);
  };

  const loadFromBox = async (g: GiftKeepsake) => {
    setGiftName(g.name);
    setDescription(g.description);
    setImg(g.image ? await dataURLToImg(g.image, GIFT_SIZE) : blankGift());
    setArt(g.art);
    setSavedId(g.id);
    setDirty(false);
    setProblem(null);
    setNotice(null);
  };

  const touched = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setDirty(true);
    setNotice(null);
    setProblem(null);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("keepsakes.gift.title", { name })}
      closeLabel={t("common.close")}
      size="xl"
      footer={
        busy === "give" ? (
          <PixelButton size="sm" variant="ghost" icon="close" onClick={stopGiving} data-gift-stop>
            {t("keepsakes.photo.stop")}
          </PixelButton>
        ) : (
          <>
            <PixelButton size="sm" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </PixelButton>
            <PixelButton size="sm" variant="magic" icon="check" loading={busy === "save"} disabled={!!busy && busy !== "save"} onClick={onSave} data-gift-save>
              {t("keepsakes.gift.save")}
            </PixelButton>
            <PixelButton size="sm" variant="primary" icon="gift" disabled={!named || !!busy || !aiMode || !worldId} onClick={give} data-gift-give>
              {t("keepsakes.gift.give", { name })}
            </PixelButton>
          </>
        )
      }
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]" data-gift-creator>
        {/* Left: details and picture */}
        <div className="flex min-w-0 flex-col gap-4">
          {busy === "give" ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center" role="status" data-gift-thinking>
              <PixelIcon name="gift" size={36} className="animate-bob text-rose" />
              <p className="font-head text-lg font-bold">{t("keepsakes.gift.unwrapping", { name })}</p>
            </div>
          ) : (
            <>
              <Field label={t("keepsakes.gift.name")} value={giftName} onChange={touched(setGiftName)} placeholder={t("keepsakes.gift.namePlaceholder")} maxLength={GIFT_NAME_MAX} />
              <Field
                label={t("keepsakes.gift.description")}
                value={description}
                onChange={touched(setDescription)}
                placeholder={t("keepsakes.gift.descriptionPlaceholder")}
                multiline
                rows={2}
                maxLength={GIFT_DESCRIPTION_MAX}
              />

              <fieldset className="flex flex-col gap-3">
                <legend className="mb-2 font-label text-xs uppercase tracking-wide text-label">{t("keepsakes.gift.picture")}</legend>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("keepsakes.gift.picture")}>
                  {(["draw", "ai"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={mode === m}
                      onClick={() => setMode(m)}
                      className="px-btn min-h-11 px-2 text-[15px]"
                      style={buttonStyle(mode === m ? "accent" : "ghost")}
                      data-gift-mode={m}
                    >
                      <PixelIcon name={m === "draw" ? "pencil" : "sparkle"} size={12} />
                      {t(`keepsakes.gift.mode.${m}`)}
                      {m === "ai" && ai && !imageReady && <span className="bg-well px-1 font-label text-[9px] uppercase text-ink-mute">{t("keepsakes.gift.unavailableTag")}</span>}
                    </button>
                  ))}
                </div>

                {mode === "draw" ? (
                  <PixelCanvasEditor
                    value={img}
                    onChange={edit}
                    onClear={() => edit(blankGift())}
                    note={t("keepsakes.gift.drawNote")}
                    label={t("keepsakes.gift.canvas")}
                    canvasClassName="max-w-[256px] sm:w-56 sm:shrink-0"
                    stacked
                  />
                ) : imageReady ? (
                  <div className="flex flex-col gap-2 bg-lavender-hi p-3 shadow-[inset_0_0_0_2px_var(--color-lavender)]" data-gift-ai="ready">
                    <p className="text-sm text-ink-soft">{t("keepsakes.gift.aiIntro")}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <PixelButton size="sm" variant="magic" icon="sparkle" loading={busy === "ai"} disabled={!!busy && busy !== "ai"} onClick={generate}>
                        {preview && art === "ai" ? t("keepsakes.gift.regenerate") : t("keepsakes.gift.generate")}
                      </PixelButton>
                      {preview && art === "ai" && (
                        <PixelButton size="sm" variant="ghost" icon="pencil" onClick={() => setMode("draw")}>
                          {t("keepsakes.gift.touchUp")}
                        </PixelButton>
                      )}
                    </div>
                    {busy === "ai" && <p className="text-sm text-ink-soft">{t("keepsakes.gift.generating")}</p>}
                    {aiError && (
                      <p className="bg-peach-hi px-2 py-1.5 text-sm shadow-[inset_4px_0_0_var(--color-coral)]" role="alert">
                        {aiError}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 bg-well p-3 shadow-[inset_0_0_0_2px_var(--color-line)]" data-gift-ai="unavailable">
                    <p className="flex items-center gap-2 font-head text-base font-bold text-ink-soft">
                      <PixelIcon name="offline" size={12} className="text-ink-mute" />
                      {ai ? t("keepsakes.gift.aiUnavailableTitle") : t("keepsakes.gift.aiChecking")}
                    </p>
                    {ai && <p className="text-sm text-ink-soft">{t("keepsakes.gift.aiUnavailableBody")}</p>}
                    <div>
                      <PixelButton size="sm" variant="ghost" icon="pencil" onClick={() => setMode("draw")}>
                        {t("keepsakes.gift.drawInstead")}
                      </PixelButton>
                    </div>
                  </div>
                )}
              </fieldset>
            </>
          )}
        </div>

        {/* Right: item preview, like an inventory card, and this world's gift box */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="font-label text-xs uppercase tracking-wide text-label">{t("keepsakes.gift.preview")}</p>
            <div className="relative bg-surface p-3 shadow-[0_0_0_2px_var(--color-lavender-lo),0_4px_0_0_rgba(91,74,134,0.16)]" data-gift-preview>
              <div className="px-checker mx-auto grid size-32 place-items-center shadow-[inset_0_0_0_2px_var(--color-line)]">
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt={t("keepsakes.gift.previewAlt", { gift: giftName.trim() || t("keepsakes.gift.untitled") })} width={GIFT_SIZE * 3} height={GIFT_SIZE * 3} className="pixelated animate-bob" />
                ) : (
                  <span className="flex flex-col items-center gap-1 text-ink-mute">
                    <PixelIcon name="gift" size={36} />
                    <span className="font-label text-[9px] uppercase">{t("keepsakes.gift.noPicture")}</span>
                  </span>
                )}
              </div>
              <p className="mt-3 truncate text-center font-head text-lg font-bold">{giftName.trim() || <span className="text-ink-mute">{t("keepsakes.gift.untitled")}</span>}</p>
              <p className="mt-1 line-clamp-4 text-center text-sm break-words text-ink-soft">{description.trim() || t("keepsakes.gift.noDescription")}</p>
              {art === "ai" && preview && <p className="mt-2 text-center font-label text-[9px] uppercase text-label">{t("keepsakes.gift.aiMade")}</p>}
            </div>
            {notice && (
              <p className="flex items-center gap-2 bg-mint-hi px-2 py-1.5 text-sm text-mint-deep" role="status" data-gift-notice>
                <PixelIcon name="check" size={10} /> {notice}
              </p>
            )}
            {problem && (
              <p className="bg-peach-hi px-2 py-1.5 text-sm shadow-[inset_4px_0_0_var(--color-coral)]" role="alert">
                {problem}
              </p>
            )}
          </div>

          {giveError && (
            <div className="flex flex-col gap-2 bg-peach-hi px-2 py-2 text-sm shadow-[inset_4px_0_0_var(--color-coral)]" role="alert" data-gift-error>
              <p>{giveError}</p>
              {canRetry && (
                <PixelButton size="sm" variant="ghost" icon="undo" onClick={give} className="self-start" data-gift-retry>
                  {t("keepsakes.photo.tryAgain")}
                </PixelButton>
              )}
            </div>
          )}
          <p className="flex items-start gap-2 text-xs text-ink-soft" data-gift-ai-note>
            <PixelIcon name={aiMode ? "sparkle" : "offline"} size={10} className="mt-0.5 shrink-0 text-label" />
            {!worldId ? t("keepsakes.menu.demo") : aiMode === "ai" ? t("keepsakes.gift.sendNote", { name }) : aiMode === "mock" ? t("keepsakes.gift.sendMock", { name }) : t("keepsakes.gift.aiOff")}
          </p>

          {box.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="font-label text-xs uppercase tracking-wide text-label">{t("keepsakes.gift.box", { count: box.length })}</p>
              <ul className="flex flex-wrap gap-1.5" data-gift-box>
                {box.slice(0, 12).map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => void loadFromBox(g)}
                      title={g.name}
                      aria-label={t("keepsakes.gift.openSaved", { gift: g.name })}
                      aria-pressed={g.id === savedId}
                      className={`px-focus grid size-11 place-items-center bg-surface ${g.id === savedId ? "shadow-[0_0_0_3px_var(--color-butter-lo)]" : "shadow-[0_0_0_2px_var(--color-line)] hover:shadow-[0_0_0_2px_var(--color-lavender)]"}`}
                    >
                      {g.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={g.image} alt="" width={32} height={32} className="pixelated" />
                      ) : (
                        <PixelIcon name="gift" size={18} className="text-ink-mute" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
