"""Rebuild an off-grid AI image on a true pixel grid, for evaluating candidate game resolutions.

AI "pixel art" has pixels of varying size, so a plain resize either blurs (averaging) or breaks
clusters (nearest neighbour). Instead:
  1. reduce the source to a fixed palette (no dithering), so every source pixel is one palette index;
  2. for each target pixel, take the MOST COMMON palette index in its source block (a vote, not an average),
     so edges stay hard and small highlights survive if they own their block;
  3. remove orphan pixels (a pixel whose 4 neighbours all agree on another colour).
Outputs the native image and integer-scaled previews. Needs Pillow + numpy.

  python3 scripts/art-test/pixelize.py SRC OUT_DIR --width 480 --height 270 --colors 48 --scales 2 3
"""
import argparse
import os

import numpy as np
from PIL import Image


def pixelize(src: Image.Image, w: int, h: int, colors: int) -> Image.Image:
    rgb = src.convert("RGB")
    # Crop to the target aspect ratio (centre) so pixels stay square.
    sw, sh = rgb.size
    want = w / h
    if sw / sh > want:
        nw = round(sh * want)
        rgb = rgb.crop(((sw - nw) // 2, 0, (sw - nw) // 2 + nw, sh))
    elif sw / sh < want:
        nh = round(sw / want)
        rgb = rgb.crop((0, (sh - nh) // 2, sw, (sh - nh) // 2 + nh))
    q = rgb.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    idx = np.asarray(q)
    pal = np.array(q.getpalette()[: colors * 3], dtype=np.uint8).reshape(-1, 3)
    H, W = idx.shape
    ys = np.linspace(0, H, h + 1).round().astype(int)
    xs = np.linspace(0, W, w + 1).round().astype(int)
    out = np.zeros((h, w), dtype=np.int32)
    for y in range(h):
        band = idx[ys[y] : ys[y + 1]]
        for x in range(w):
            block = band[:, xs[x] : xs[x + 1]].ravel()
            out[y, x] = np.bincount(block, minlength=colors).argmax()
    # Orphan cleanup: a pixel unlike all four neighbours, which all agree, takes their colour.
    p = np.pad(out, 1, mode="edge")
    n, s, e, wv = p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, 2:], p[1:-1, :-2]
    agree = (n == s) & (s == e) & (e == wv) & (n != out)
    out = np.where(agree, n, out)
    return Image.fromarray(pal[out], "RGB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out_dir")
    ap.add_argument("--width", type=int, required=True)
    ap.add_argument("--height", type=int, required=True)
    ap.add_argument("--colors", type=int, default=48)
    ap.add_argument("--scales", type=int, nargs="+", default=[2, 3])
    ap.add_argument("--name", default=None)
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)
    base = a.name or os.path.splitext(os.path.basename(a.src))[0]
    img = pixelize(Image.open(a.src), a.width, a.height, a.colors)
    tag = f"{base}-{a.width}x{a.height}"
    img.save(os.path.join(a.out_dir, f"{tag}-native.png"))
    for s in a.scales:
        img.resize((a.width * s, a.height * s), Image.NEAREST).save(os.path.join(a.out_dir, f"{tag}-x{s}.png"))
    print("wrote", tag)


if __name__ == "__main__":
    main()
