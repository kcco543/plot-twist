"""Build the Batch 1 review package from scripts/art-test/out/ (no API calls).

For each room concept: the raw output, and the grid rebuild at 640x360, 480x270 and 320x180, each native
and at its integer preview scale, plus same-region close-ups so detail retention is comparable.
For the window: both states on a checkerboard, the alpha outline (hit area), and a state-alignment check
(bounding boxes, frame pixels that differ between states).

  python3 scripts/art-test/review.py scripts/art-test/out REVIEW_DIR
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from pixelize import pixelize  # noqa: E402

GRIDS = [(640, 360, 2), (480, 270, 3), (320, 180, 4)]  # native size, integer preview scale (all ~1280-1440 wide)
BG = (37, 36, 43)
INK = (240, 223, 197)


def label(img, text):
    out = Image.new("RGB", (img.width, img.height + 20), BG)
    out.paste(img, (0, 20))
    ImageDraw.Draw(out).text((4, 4), text, fill=INK)
    return out


def room(src_path, dst):
    name = os.path.splitext(os.path.basename(src_path))[0]
    src = Image.open(src_path).convert("RGB")
    src.save(os.path.join(dst, f"{name}-raw.png"))
    closeups = []
    for w, h, s in GRIDS:
        nat = pixelize(src, w, h, 128)
        nat.save(os.path.join(dst, f"{name}-{w}x{h}-native.png"))
        nat.resize((w * s, h * s), Image.NEAREST).save(os.path.join(dst, f"{name}-{w}x{h}-x{s}.png"))
        # Same region (centre-left floor, where characters stand) at the same on-screen size.
        box = (int(w * 0.30), int(h * 0.40), int(w * 0.62), int(h * 0.78))
        c = nat.crop(box)
        k = 560 // c.width or 1
        c = c.resize((c.width * k, c.height * k), Image.NEAREST).resize((560, int(560 * c.height / c.width)), Image.NEAREST)
        closeups.append(label(c, f"{w}x{h} native, close-up"))
    raw = src.crop((int(src.width * 0.30), int(src.height * 0.40), int(src.width * 0.62), int(src.height * 0.78))).resize((560, closeups[0].height - 20), Image.NEAREST)
    tiles = [label(raw, "raw output, same region")] + closeups
    sheet = Image.new("RGB", (2 * 570, 2 * (tiles[0].height + 10)), BG)
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % 2) * 570, (i // 2) * (t.height + 10)))
    sheet.save(os.path.join(dst, f"{name}-closeups.png"))


def checker(size, a=(70, 66, 76), b=(52, 49, 57), cell=16):
    w, h = size
    yy, xx = np.mgrid[0:h, 0:w]
    m = ((yy // cell + xx // cell) % 2 == 0)[..., None]
    return Image.fromarray(np.where(m, np.array(a, np.uint8), np.array(b, np.uint8)).astype(np.uint8), "RGB")


def window(out_dir, dst):
    paths = {s: os.path.join(out_dir, f"window-{s}.png") for s in ("closed", "open")}
    states = {s: Image.open(p).convert("RGBA") for s, p in paths.items() if os.path.exists(p)}
    report = {}
    for s, im in states.items():
        a = np.asarray(im)[..., 3]
        report[s] = {"bbox": Image.fromarray(a).getbbox(), "opaque_px": int((a > 128).sum()), "semi_px": int(((a > 0) & (a < 255)).sum()), "corner_alpha": int(a[0, 0])}
        bg = checker(im.size)
        bg.paste(im, (0, 0), im)
        bg.save(os.path.join(dst, f"window-{s}-on-checker.png"))
        hit = Image.fromarray(((a > 128) * 255).astype(np.uint8))
        hit.save(os.path.join(dst, f"window-{s}-hit-area.png"))
    if len(states) == 2:
        A, B = (np.asarray(states[s]).astype(int) for s in ("closed", "open"))
        both = (A[..., 3] > 128) & (B[..., 3] > 128)
        diff = (np.abs(A[..., :3] - B[..., :3]).sum(-1) > 40) & both
        report["alignment"] = {
            "same_bbox": report["closed"]["bbox"] == report["open"]["bbox"],
            "changed_share_of_overlap": round(float(diff.sum() / max(both.sum(), 1)), 3),
        }
        vis = np.zeros((*diff.shape, 3), np.uint8)
        vis[both] = (80, 76, 88)
        vis[diff] = (199, 160, 106)
        Image.fromarray(vis).save(os.path.join(dst, "window-state-diff.png"))
    with open(os.path.join(dst, "window-report.json"), "w") as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))


def main():
    src, dst = sys.argv[1], sys.argv[2]
    os.makedirs(dst, exist_ok=True)
    for f in sorted(os.listdir(src)):
        if f.startswith("room-") and f.endswith(".png"):
            room(os.path.join(src, f), dst)
            print("room", f)
    window(src, dst)


if __name__ == "__main__":
    main()
