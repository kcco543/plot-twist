import "server-only";
import { deflateSync } from "node:zlib";

/**
 * REGION EDIT MASK
 * --------------------------------------------------------------------------
 * The image service edits only where the mask is transparent. The browser
 * sends the player's selection as fractions of the map (0..1), and this file
 * turns it into a PNG mask the exact size of the map: opaque everywhere,
 * transparent inside the selection (grown by a small margin so the new
 * content can blend into its surroundings). The browser later pastes back
 * only the selected rectangle, so everything outside it stays pixel-for-pixel
 * as it was.
 */

import type { Region } from "@/lib/mapSelection";

/** Extra room around the selection the model may repaint, as a share of the map's shorter side. */
export const MASK_MARGIN = 0.02;

/** Width and height of a PNG or WebP file, read from its header. */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length >= 24 && buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG" && buf.toString("ascii", 12, 16) === "IHDR") {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    if (chunk === "VP8 " && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === "VP8L" && buf[20] === 0x2f) {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

/** The selection in whole pixels, grown by `margin` and kept inside the map. */
export function regionToPixels(r: Region, width: number, height: number, margin = MASK_MARGIN) {
  const pad = Math.round(Math.min(width, height) * margin);
  const left = Math.max(0, Math.floor(r.x * width) - pad);
  const top = Math.max(0, Math.floor(r.y * height) - pad);
  const right = Math.min(width, Math.ceil((r.x + r.w) * width) + pad);
  const bottom = Math.min(height, Math.ceil((r.y + r.h) * height) + pad);
  return { left, top, right, bottom };
}

/** RGBA PNG mask: transparent (= repaint) inside the region, opaque elsewhere. */
export function buildMask(width: number, height: number, region: Region, margin = MASK_MARGIN): Buffer {
  const { left, top, right, bottom } = regionToPixels(region, width, height, margin);
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride; // filter byte 0 at raw[row]
    const inRows = y >= top && y < bottom;
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 4;
      // Opaque black keeps the pixel; fully transparent marks it for editing.
      raw[i + 3] = inRows && x >= left && x < right ? 0 : 255;
    }
  }
  return encodePng(width, height, raw);
}

function encodePng(width: number, height: number, raw: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

let table: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
