/**
 * Photo helpers: checking a chosen file, and turning a camera frame or an
 * uploaded picture into the small JPEG that is kept. Re-encoding through a
 * canvas also drops the photo's metadata (location, device…).
 */

/** Biggest file the player can pick (phone photos are usually 2–8 MB). */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
/** Longest side of the kept photo, px. */
export const PHOTO_MAX_SIDE = 1280;

export type PhotoProblem = "type" | "size" | "empty" | "unreadable" | "denied" | "noCamera" | "cameraBusy" | "cameraFailed" | "saveFailed";

/** Quick check before decoding. Decoding can still fail ("unreadable"). */
export function checkPhotoFile(file: { type: string; size: number; name?: string }): PhotoProblem | null {
  if (file.size === 0) return "empty";
  // Some phones leave the type empty for camera files; let decoding decide then.
  const looksLikeImage = file.type ? file.type.startsWith("image/") : /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp)$/i.test(file.name ?? "");
  if (!looksLikeImage || file.type === "image/svg+xml") return "type";
  if (file.size > MAX_PHOTO_BYTES) return "size";
  return null;
}

/** Fit (w, h) inside a square of `max`, never enlarging. */
export function fitWithin(w: number, h: number, max = PHOTO_MAX_SIDE): { w: number; h: number } {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** Map a getUserMedia error to what the player is told. */
export function cameraProblem(err: unknown): PhotoProblem {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "noCamera";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "cameraBusy";
  return "cameraFailed";
}

export type EncodedPhoto = { blob: Blob; url: string; width: number; height: number };

/** Draw a video frame or decoded image to a canvas and encode the kept JPEG. Browser only. */
export async function encodePhoto(source: CanvasImageSource, srcW: number, srcH: number, mirror = false): Promise<EncodedPhoto> {
  const { w, h } = fitWithin(srcW, srcH);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#fffaf3"; // transparent PNGs get the cream paper colour, not black
  ctx.fillRect(0, 0, w, h);
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, w, h);
  const blob = await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.86));
  return { blob, url: URL.createObjectURL(blob), width: w, height: h };
}

/** Decode a chosen file and re-encode it. Rejects with a PhotoProblem code. */
export async function photoFromFile(file: File): Promise<EncodedPhoto> {
  const problem = checkPhotoFile(file);
  if (problem) throw problem;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw "unreadable" satisfies PhotoProblem;
    }
    if (!img.naturalWidth || !img.naturalHeight) throw "unreadable" satisfies PhotoProblem;
    return await encodePhoto(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}
