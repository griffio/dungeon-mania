#!/usr/bin/env python3
"""Trace the book's map (docs/reference/kollchap-map.jpg) into a draft grid, and check the
curated grid in src/dungeon-data.js against the scan.

    python3 tools/trace-map.py                     # measure, fit the grid, write the draft
    python3 tools/trace-map.py --pitch 60          # try another tile size
    python3 tools/trace-map.py --overlay 0,0,27,34 # curated map over the scan, tiles x0,y0,x1,y1

Writes into tools/out/ (scratch output, not shipped):
  draft.txt      '.' floor / '#' rock, one character per 5 ft tile
  fractions.txt  floor fraction per tile as 0-9, for judging the ambiguous ones
  overlay.png    with --overlay: the curated map drawn over the scan, with tile numbers

How the draft is made:
  1. Floor is light paper wide enough to be a room or passage: the light mask is opened
     (eroded then dilated) so the speckle that marks solid rock disappears.
  2. Light regions touching the image edge are the paper around the dungeon and are dropped.
  3. The scale bar and passage widths are measured and reported. The drawing is not quite to
     scale: the 5 ft bar is ~66 px, but 5 ft passages are only ~45-55 px between their wall
     lines. Play depends on passages being one tile, so the tile is sized to the passages
     (--pitch, default 54 px) rather than to the bar.
  4. The grid origin is fitted so tiles come out as clearly floor or clearly rock.

The draft is only a starting point. Thin walls between rooms need a whole rock tile on the
grid, doors need a tile of their own, and the rubble rooms (9a, 20, 23) are lost by step 1,
so the map is finished by hand in src/dungeon-data.js (PLAN.md 7.3).

Needs Python 3 with Pillow and NumPy.
"""
import argparse, re, sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SCAN = ROOT / 'docs/reference/kollchap-map.jpg'
DATA = ROOT / 'src/dungeon-data.js'
OUT = ROOT / 'tools/out'
SCALEBAR = (2180, 170, 2370, 245)   # px box around the "5ft" bar's two end ticks
DUNGEON = (0, 0, 2850, 1850)        # px box holding the map itself (excludes legend and title)


def window_sum(a, k, axis):
    """Sum over a centred window of k along one axis, zero beyond the edges."""
    r = k // 2
    pad = [(0, 0), (0, 0)]
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad), axis=axis)
    return c[k:] - c[:-k] if axis == 0 else c[:, k:] - c[:, :-k]


def box_open(m, k):
    """Binary opening with a k x k square: erode (whole box set), then dilate (any of it set).
    Running sums make it cost the same for any k, unlike rank filters."""
    a = m.astype(np.int32)
    eroded = (window_sum((window_sum(a, k, 0) == k).astype(np.int32), k, 1) == k).astype(np.int32)
    return window_sum((window_sum(eroded, k, 0) > 0).astype(np.int32), k, 1) > 0


def floor_mask(gray, open_px=17):
    m = box_open(np.asarray(gray) > 120, open_px)
    x0, y0, x1, y1 = DUNGEON
    keep = np.zeros_like(m)
    keep[y0:y1, x0:x1] = m[y0:y1, x0:x1]
    return drop_edge_regions(keep)


def drop_edge_regions(m, step=4):
    """Remove light regions that touch the image or dungeon edge, and specks, at 1/step scale."""
    s = m[::step, ::step]
    h, w = s.shape
    x1, y1 = DUNGEON[2] // step - 1, DUNGEON[3] // step - 1
    lab = np.zeros((h, w), np.int32)
    good = [False]
    n = 0
    for y in range(h):
        for x in range(w):
            if not s[y, x] or lab[y, x]:
                continue
            n += 1
            stack, size, edge = [(y, x)], 0, False
            lab[y, x] = n
            while stack:
                a, b = stack.pop()
                size += 1
                if a in (0, h - 1) or b in (0, w - 1) or a >= y1 or b >= x1:
                    edge = True
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    yy, xx = a + dy, b + dx
                    if 0 <= yy < h and 0 <= xx < w and s[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = n
                        stack.append((yy, xx))
            good.append(not edge and size * step * step >= 4800)
    kept = np.array(good)[lab]
    return np.kron(kept, np.ones((step, step), bool))[: m.shape[0], : m.shape[1]]


def scale_bar(gray):
    """Distance between the centres of the scale bar's two end ticks, in px."""
    x0, y0, x1, y1 = SCALEBAR
    dark = np.asarray(gray.crop(SCALEBAR)) < 100
    cols = dark.mean(axis=0) > 0.4   # the ticks are tall; the bar between them is thin
    runs, start = [], None
    for i, v in enumerate(list(cols) + [False]):
        if v and start is None:
            start = i
        if not v and start is not None:
            runs.append((start + i - 1) / 2)
            start = None
    return runs[-1] - runs[0] if len(runs) >= 2 else None


def passage_width(m):
    """Most common width of light runs 25-90 px long: the 5 ft passages."""
    counts = np.zeros(100, int)
    for arr in (m, m.T):
        for line in arr[::7]:
            d = np.diff(np.concatenate(([0], line.astype(np.int8), [0])))
            for a, b in zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]):
                if 25 <= b - a < 90:
                    counts[b - a] += 1
    smooth = np.convolve(counts, np.ones(5), 'same')
    return int(np.argmax(smooth))


def fractions(m, pitch, ox, oy):
    h, w = (m.shape[0] - oy) // pitch, (m.shape[1] - ox) // pitch
    return m[oy:oy + h * pitch, ox:ox + w * pitch].reshape(h, pitch, w, pitch).mean(axis=(1, 3))


def fit_origin(m, pitch):
    """Origin offset that makes tiles most clearly floor or rock. An integral image gives
    every tile's floor count from four lookups, so all pitch x pitch offsets are cheap."""
    sat = np.zeros((m.shape[0] + 1, m.shape[1] + 1))
    sat[1:, 1:] = m.cumsum(0).cumsum(1)
    best = None
    for oy in range(pitch):
        ys = np.arange(oy, m.shape[0] + 1, pitch)
        for ox in range(pitch):
            c = sat[np.ix_(ys, np.arange(ox, m.shape[1] + 1, pitch))]
            a = (c[1:, 1:] - c[:-1, 1:] - c[1:, :-1] + c[:-1, :-1]) / pitch ** 2
            occ = a[a > 0.02]
            score = np.mean(np.abs(occ - 0.5)) if occ.size else 0
            if best is None or score > best[0]:
                best = (score, ox, oy)
    return best[1], best[2]


def curated_map():
    src = DATA.read_text()
    found = re.search(r'export const MAP = String\.raw`\n(.*?)`', src, re.S)
    if not found:
        sys.exit(f'no MAP found in {DATA}')
    grid = re.search(r'export const TRACE = \{ pitch: (\d+), origin: \[(\d+), (\d+)\]', src)
    return found.group(1).rstrip('\n').split('\n'), tuple(map(int, grid.groups()))


def overlay(box, scale=1.0):
    rows, (pitch, ox, oy) = curated_map()
    x0, y0, x1, y1 = box
    src = Image.open(SCAN).convert('RGB')
    crop = src.crop((ox + x0 * pitch, oy + y0 * pitch, ox + x1 * pitch, oy + y1 * pitch))
    crop = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS).convert('RGBA')
    t, margin = pitch * scale, 26
    layer = Image.new('RGBA', crop.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    font = ImageFont.load_default(size=max(10, int(t * 0.45)))
    for y in range(y0, y1):
        for x in range(x0, x1):
            c = rows[y][x] if y < len(rows) and x < len(rows[y]) else '#'
            if c == '#':
                continue
            bx, by = (x - x0) * t, (y - y0) * t
            fill = (0, 200, 0, 70) if c == '.' else (255, 140, 0, 90)
            d.rectangle([bx + 1, by + 1, bx + t - 1, by + t - 1], fill=fill)
            if c != '.':
                d.text((bx + t * 0.3, by + t * 0.2), c, fill=(200, 0, 0, 255), font=font)
    for x in range(x0, x1 + 1):
        d.line([((x - x0) * t, 0), ((x - x0) * t, crop.height)], fill=(255, 0, 0, 200) if x % 5 == 0 else (0, 90, 255, 110))
    for y in range(y0, y1 + 1):
        d.line([(0, (y - y0) * t), (crop.width, (y - y0) * t)], fill=(255, 0, 0, 200) if y % 5 == 0 else (0, 90, 255, 110))
    img = Image.alpha_composite(crop, layer).convert('RGB')
    out = Image.new('RGB', (img.width + margin, img.height + margin), 'white')
    out.paste(img, (margin, margin))
    d = ImageDraw.Draw(out)
    small = ImageFont.load_default(size=14)
    for x in range(x0, x1):
        d.text((margin + (x - x0) * t + t / 2 - 8, 5), str(x), fill='black', font=small)
    for y in range(y0, y1):
        d.text((2, margin + (y - y0) * t + t / 2 - 8), str(y), fill='black', font=small)
    OUT.mkdir(exist_ok=True)
    out.save(OUT / 'overlay.png')
    print(f'wrote {OUT / "overlay.png"}')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pitch', type=int, default=54, help='px per 5 ft tile (default 54)')
    ap.add_argument('--origin', help='grid origin "x,y" in px (default: fitted)')
    ap.add_argument('--overlay', help='tiles "x0,y0,x1,y1": draw the curated map over the scan')
    ap.add_argument('--scale', type=float, default=1.0, help='overlay zoom (default 1)')
    args = ap.parse_args()
    if args.overlay:
        overlay(tuple(map(int, args.overlay.split(','))), args.scale)
        return

    gray = Image.open(SCAN).convert('L')
    print(f'scan {gray.width} x {gray.height} px')
    m = floor_mask(gray)
    bar = scale_bar(gray)
    print(f'scale bar (5 ft): {bar:.0f} px between tick centres' if bar else 'scale bar not found')
    print(f'passages: ~{passage_width(m)} px clear between wall lines')
    pitch = args.pitch
    ox, oy = map(int, args.origin.split(',')) if args.origin else fit_origin(m, pitch)
    a = fractions(m.astype(np.float32), pitch, ox, oy)
    print(f'grid: {pitch} px per tile, origin ({ox}, {oy}) px, {a.shape[1]} x {a.shape[0]} tiles')
    OUT.mkdir(exist_ok=True)
    (OUT / 'draft.txt').write_text('\n'.join(''.join('.' if v >= 0.45 else '#' for v in r) for r in a) + '\n')
    (OUT / 'fractions.txt').write_text('\n'.join(''.join('.' if v < 0.05 else str(min(9, int(v * 10))) for v in r) for r in a) + '\n')
    print(f'wrote {OUT / "draft.txt"} and {OUT / "fractions.txt"}')


if __name__ == '__main__':
    main()
