"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { Field } from "@/components/ui/Field";
import { cameraProblem, encodePhoto, photoFromFile, type EncodedPhoto, type PhotoProblem } from "@/lib/keepsakes/photo";
import { PHOTO_CAPTION_MAX } from "@/lib/keepsakes/types";
import { PHOTO_RETRYABLE, type PhotoErrorCode, type PhotoResult } from "@/lib/photo/request";
import { useI18n } from "@/i18n";

type Facing = "user" | "environment";
type Stage = "empty" | "camera" | "preview" | "confirm" | "sending";
export type PhotoShot = EncodedPhoto & { source: "camera" | "upload" };

const canUseCamera = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof window !== "undefined" && window.isSecureContext;

/**
 * Photo window: take a photo with the camera (only after the browser asks the
 * player for permission) or pick one from the device, preview it, add an
 * optional caption, then Show to Character. Show first explains that the
 * photo goes to an external AI (Anthropic's Claude) and only Send actually
 * sends it. While the character looks, the player can stop; a failure is
 * explained here with Try again. On success the page plays the reaction on
 * the stage and closes this window. Nothing is stored here: the photo is
 * kept only if the player then saves the moment as a memory.
 */
export function PhotoPanel({
  open,
  canKeep,
  ai,
  characterId,
  name,
  onClose,
  onSend,
}: {
  open: boolean;
  /** A saved character in the active world (not the demo cast). */
  canKeep: boolean;
  /** How reactions are made: real AI, developer TEST replies, or off. */
  ai: "ai" | "mock" | null;
  characterId: string;
  name: string;
  onClose: () => void;
  /** Send the confirmed photo for a reaction. On ok the page takes over (and closes this window). */
  onSend: (shot: PhotoShot, caption: string, signal: AbortSignal) => Promise<PhotoResult>;
}) {
  const { t } = useI18n();
  const [stage, setStage] = useState<Stage>("empty");
  const [photo, setPhoto] = useState<PhotoShot | null>(null);
  const [caption, setCaption] = useState("");
  const [problem, setProblem] = useState<PhotoProblem | null>(null);
  const [busy, setBusy] = useState<"camera" | "file" | null>(null);
  const [sendError, setSendError] = useState<PhotoErrorCode | null>(null);
  const sending = useRef<AbortController | null>(null);
  const [facing, setFacing] = useState<Facing>("environment");
  const [mirror, setMirror] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const captureInput = useRef<HTMLInputElement>(null);

  const stopCamera = useCallback(() => {
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  const setPicture = useCallback((next: PhotoShot | null) => {
    setPhoto((prev) => {
      if (prev && prev.url !== next?.url) URL.revokeObjectURL(prev.url);
      return next;
    });
  }, []);

  // Fresh panel every time it opens; camera off and preview URL released when it closes.
  useEffect(() => {
    if (!open) return;
    setStage("empty");
    setCaption("");
    setProblem(null);
    setSendError(null);
    setBusy(null);
    return () => {
      sending.current?.abort();
      sending.current = null;
      stopCamera();
      setPicture(null);
    };
  }, [open, characterId, stopCamera, setPicture]);

  const startCamera = async (want: Facing = facing) => {
    setProblem(null);
    if (!canUseCamera()) {
      // No live camera here (old browser, or the page isn't on https): the phone's own camera app via the file picker.
      captureInput.current?.click();
      return;
    }
    stopCamera();
    setBusy("camera");
    try {
      // This is the moment the browser asks the player for camera permission.
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: want }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
      stream.current = s;
      const settings = s.getVideoTracks()[0]?.getSettings?.() ?? {};
      // Front cameras (and laptop webcams) are shown mirrored, like a mirror; the photo is saved the same way.
      setMirror(settings.facingMode ? settings.facingMode === "user" : want === "user" || !matchMedia("(pointer: coarse)").matches);
      setFacing(want);
      setStage("camera");
      requestAnimationFrame(() => {
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => {});
        }
      });
    } catch (err) {
      setProblem(cameraProblem(err));
    } finally {
      setBusy(null);
    }
  };

  const capture = async () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    try {
      const shot = await encodePhoto(v, v.videoWidth, v.videoHeight, mirror);
      setPicture({ ...shot, source: "camera" });
      setStage("preview");
      stopCamera();
    } catch {
      setProblem("cameraFailed");
    }
  };

  const onFile = async (input: HTMLInputElement, source: "camera" | "upload") => {
    const file = input.files?.[0];
    input.value = ""; // picking the same file again still fires
    if (!file) return; // the player cancelled the picker: keep whatever was there
    setProblem(null);
    setBusy("file");
    try {
      const shot = await photoFromFile(file);
      stopCamera();
      setPicture({ ...shot, source });
      setStage("preview");
    } catch (err) {
      setProblem(typeof err === "string" ? (err as PhotoProblem) : "unreadable");
    } finally {
      setBusy(null);
    }
  };

  /** Only after the player pressed Send in the confirmation: the one moment the photo leaves the device. */
  const send = async () => {
    if (!photo || !canKeep || !ai) return;
    sending.current?.abort();
    const ctrl = new AbortController();
    sending.current = ctrl;
    setSendError(null);
    setStage("sending");
    const r = await onSend(photo, caption.slice(0, PHOTO_CAPTION_MAX), ctrl.signal);
    if (sending.current !== ctrl) return; // closed or stopped meanwhile
    sending.current = null;
    if (r.ok) return; // the page plays the reaction and closes this window
    setStage("preview");
    if (r.code !== "cancelled") setSendError(r.code);
  };

  const stopSending = () => {
    sending.current?.abort();
    sending.current = null;
    setStage("preview");
  };

  const close = () => {
    sending.current?.abort();
    sending.current = null;
    stopCamera();
    onClose();
  };

  const confirming = stage === "confirm" || stage === "sending";
  const blockedReason = !canKeep ? t("keepsakes.menu.demo") : !ai ? t("keepsakes.photo.aiOff") : null;

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("keepsakes.photo.title", { name })}
      closeLabel={t("common.close")}
      size="lg"
      footer={
        stage === "sending" ? (
          <PixelButton size="sm" variant="ghost" icon="close" onClick={stopSending} data-photo-stop>
            {t("keepsakes.photo.stop")}
          </PixelButton>
        ) : stage === "confirm" ? (
          <>
            <PixelButton size="sm" variant="ghost" onClick={() => setStage("preview")} data-photo-back>
              {t("keepsakes.photo.back")}
            </PixelButton>
            <PixelButton size="sm" variant="primary" icon="heart" onClick={send} data-photo-send data-autofocus>
              {t("keepsakes.photo.send")}
            </PixelButton>
          </>
        ) : (
          <>
            <PixelButton size="sm" variant="ghost" onClick={close}>
              {t("common.cancel")}
            </PixelButton>
            <PixelButton size="sm" variant="primary" icon="heart" disabled={!photo || stage !== "preview" || !!blockedReason} onClick={() => setStage("confirm")} data-photo-show>
              {t("keepsakes.photo.show", { name })}
            </PixelButton>
          </>
        )
      }
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:items-start" data-photo-panel>
        {/* Polaroid-style frame: camera view, preview, or an empty slot */}
        <figure className="mx-auto w-full max-w-sm rotate-[-1deg] bg-surface p-2 pb-3 shadow-[0_0_0_2px_var(--color-lavender-lo),0_4px_0_0_rgba(91,74,134,0.16)] md:max-w-none">
          <div className="px-checker relative grid aspect-[4/3] w-full place-items-center overflow-hidden shadow-[inset_0_0_0_2px_var(--color-line)]">
            {stage === "camera" && (
              <video ref={video} playsInline muted autoPlay className="absolute inset-0 size-full object-cover" style={{ transform: mirror ? "scaleX(-1)" : undefined }} aria-label={t("keepsakes.photo.viewfinder")} />
            )}
            {(stage === "preview" || confirming) && photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo.url} alt={t("keepsakes.photo.previewAlt")} className="absolute inset-0 size-full object-contain" data-photo-preview />
            )}
            {stage === "empty" && (
              <div className="flex flex-col items-center gap-2 px-4 text-center text-ink-mute">
                <PixelIcon name="image" size={28} />
                <span className="font-label text-[10px] uppercase">{busy === "file" ? t("keepsakes.photo.reading") : t("keepsakes.photo.empty")}</span>
              </div>
            )}
            {stage === "sending" && (
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-surface/90 px-2 py-1.5 font-label text-[10px] uppercase text-label" role="status" data-photo-thinking>
                <PixelIcon name="eye" size={10} className="animate-pulse" /> {t("keepsakes.photo.thinking", { name })}
              </span>
            )}
          </div>
          <figcaption className="mt-2 min-h-6 px-1 text-center font-body text-base break-words text-ink-soft">{caption.trim() || (photo ? "" : " ")}</figcaption>
        </figure>

        <div className="flex min-w-0 flex-col gap-4">
          {confirming ? (
            <div className="flex flex-col gap-3" data-photo-confirm>
              <p className="font-head text-lg font-bold">{t("keepsakes.photo.sendTitle", { name })}</p>
              {ai === "mock" ? (
                <p className="flex items-start gap-2 bg-butter-hi px-2 py-1.5 text-sm text-ink-soft">
                  <span className="shrink-0 bg-butter-lo px-1 font-label text-[10px] text-ink">{t("keepsakes.photo.testTag")}</span>
                  {t("keepsakes.photo.sendMock", { name })}
                </p>
              ) : (
                <p className="flex items-start gap-2 bg-lavender-hi px-2 py-1.5 text-sm text-ink-soft" data-photo-provider>
                  <PixelIcon name="sparkle" size={11} className="mt-1 shrink-0 text-label" />
                  <span>{t("keepsakes.photo.sendBody", { name })}</span>
                </p>
              )}
              <p className="flex items-start gap-2 text-sm text-ink-soft">
                <PixelIcon name="lock" size={10} className="mt-1 shrink-0 text-label" />
                {t("keepsakes.photo.sendKeep")}
              </p>
              {caption.trim() && <p className="border-l-4 border-line pl-2 text-sm break-words text-ink-soft">“{caption.trim()}”</p>}
            </div>
          ) : (
            <>
              {stage === "camera" ? (
                <div className="flex flex-wrap gap-2">
                  <PixelButton size="sm" variant="primary" icon="camera" onClick={capture} data-photo-capture data-autofocus>
                    {t("keepsakes.photo.capture")}
                  </PixelButton>
                  <PixelButton size="sm" variant="ghost" icon="flip" onClick={() => startCamera(facing === "user" ? "environment" : "user")}>
                    {t("keepsakes.photo.flip")}
                  </PixelButton>
                  <PixelButton
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      stopCamera();
                      setStage(photo ? "preview" : "empty");
                    }}
                  >
                    {t("keepsakes.photo.stopCamera")}
                  </PixelButton>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <PixelButton size="sm" variant="primary" icon="camera" loading={busy === "camera"} onClick={() => startCamera()} data-photo-take>
                    {photo ? t("keepsakes.photo.retake") : t("keepsakes.photo.take")}
                  </PixelButton>
                  <PixelButton size="sm" variant="calm" icon="upload" disabled={busy === "file"} onClick={() => uploadInput.current?.click()} data-photo-upload>
                    {photo ? t("keepsakes.photo.another") : t("keepsakes.photo.upload")}
                  </PixelButton>
                </div>
              )}
              {/* Hidden pickers: one for existing photos, one that opens the phone's camera app. */}
              <input ref={uploadInput} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.currentTarget, "upload")} data-photo-file />
              <input ref={captureInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.currentTarget, "camera")} />

              {problem && (
                <div className="flex flex-col gap-2 bg-peach-hi px-2 py-2 text-sm text-ink shadow-[inset_4px_0_0_var(--color-coral)]" role="alert" data-photo-problem={problem}>
                  <p>{t(`keepsakes.photo.problem.${problem}`)}</p>
                  {(problem === "denied" || problem === "noCamera" || problem === "cameraBusy" || problem === "cameraFailed") && (
                    <div className="flex flex-wrap gap-2">
                      <PixelButton size="sm" variant="ghost" icon="upload" onClick={() => uploadInput.current?.click()}>
                        {t("keepsakes.photo.upload")}
                      </PixelButton>
                      {problem !== "denied" && (
                        <PixelButton size="sm" variant="ghost" icon="undo" onClick={() => startCamera()}>
                          {t("keepsakes.photo.tryAgain")}
                        </PixelButton>
                      )}
                    </div>
                  )}
                </div>
              )}

              {sendError && (
                <div className="flex flex-col gap-2 bg-peach-hi px-2 py-2 text-sm text-ink shadow-[inset_4px_0_0_var(--color-coral)]" role="alert" data-photo-error={sendError}>
                  <p>{t(`keepsakes.photo.error.${sendError}`, { name })}</p>
                  {PHOTO_RETRYABLE.has(sendError) && (
                    <PixelButton size="sm" variant="ghost" icon="undo" onClick={send} className="self-start" data-photo-retry>
                      {t("keepsakes.photo.tryAgain")}
                    </PixelButton>
                  )}
                </div>
              )}
              {photo && blockedReason && (
                <p className="flex items-start gap-2 bg-butter-hi px-2 py-1.5 text-sm text-ink-soft" data-photo-blocked>
                  <PixelIcon name="sparkle" size={11} className="mt-1 shrink-0 text-label" />
                  {blockedReason}
                </p>
              )}

              <Field
                label={t("keepsakes.photo.caption")}
                value={caption}
                onChange={setCaption}
                placeholder={t("keepsakes.photo.captionPlaceholder", { name })}
                multiline
                rows={3}
                maxLength={PHOTO_CAPTION_MAX}
              />
              <p className="flex items-start gap-2 text-sm text-ink-soft">
                <PixelIcon name="lock" size={10} className="mt-1 shrink-0 text-label" />
                {t("keepsakes.photo.privacy")}
              </p>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
