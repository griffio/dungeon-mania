#!/usr/bin/env python3
"""Build-time portraits and bestiary cards (PLAN.md 8.4), with the same Gemini call, ledger and
spending cap as generate-textures.py.

    python3 tools/generate-portraits.py              # generate anything missing, then process
    python3 tools/generate-portraits.py odric rosa   # regenerate just these
    python3 tools/generate-portraits.py --process    # reprocess cached images, no API calls
    python3 tools/generate-portraits.py --cap=3

Raw images are cached in .texture-cache/<provider>/portraits/ (gitignored); the shipped ones go
to assets/portraits/<id>.webp at 320 px. Gemini images carry Google's invisible SynthID watermark.
"""
import importlib.util, json, sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
# the texture tool's API call, key handling and ledger, without running it
sys.argv = [sys.argv[0], '--process'] + sys.argv[1:]  # keeps its own main() from calling the API on import
spec = importlib.util.spec_from_file_location('gt', ROOT / 'tools/generate-textures.py')
gt = importlib.util.module_from_spec(spec)
src = (ROOT / 'tools/generate-textures.py').read_text().replace('\nmain()\n', '\n')
exec(compile(src, 'generate-textures.py', 'exec'), gt.__dict__)
sys.argv = [sys.argv[0]] + sys.argv[2:]

MANIFEST = json.loads((ROOT / 'tools/portrait-manifest.json').read_text())
args = [a for a in sys.argv[1:] if not a.startswith('--')]
flags = {a.split('=')[0]: (a.split('=') + [''])[1] for a in sys.argv[1:] if a.startswith('--')}
gt.CAP = float(flags.get('--cap') or 3.0)
PROCESS_ONLY = '--process' in flags
CACHE = gt.CACHE / 'portraits'
OUT = ROOT / 'assets/portraits'
SHIP = 320


def trim(im):
    """Cut away the paper margin, and any black matte or ruled frame, round the painting (some
    come back as if photographed on the page), then take the middle square. The painting is
    where 8 lines in a row are mostly mid-tones; paper is pale, a matte black."""
    import numpy as np
    a = np.asarray(im, dtype=np.float32).mean(axis=2) / 255
    paint = ((a > 0.05) & (a < 0.62)).astype(np.float32)
    rows, cols = paint.mean(axis=1) > 0.55, paint.mean(axis=0) > 0.55
    def edge(ok, rev):
        idx = range(len(ok) - 1, -1, -1) if rev else range(len(ok))
        run = 0
        for k in idx:
            run = run + 1 if ok[k] else 0
            if run == 8: return k + 7 if rev else k - 7
        return len(ok) - 1 if rev else 0
    n = a.shape[0]
    t, b = min(edge(rows, False), n // 4), max(edge(rows, True) + 1, n * 3 // 4)
    l, r = min(edge(cols, False), a.shape[1] // 4), max(edge(cols, True) + 1, a.shape[1] * 3 // 4)
    pad = 8 if (t or l or b < n or r < a.shape[1]) else 0  # past the ragged edge of the paint
    t, b, l, r = t + pad, b - pad, l + pad, r - pad
    s = min(b - t, r - l)
    cy, cx = (t + b) // 2, (l + r) // 2
    return im.crop((cx - s // 2, cy - s // 2, cx - s // 2 + s, cy - s // 2 + s))


def main():
    CACHE.mkdir(parents=True, exist_ok=True); OUT.mkdir(parents=True, exist_ok=True)
    for t in MANIFEST['items']:
        if args and t['id'] not in args: continue
        raw = CACHE / f'{t["id"]}.png'
        if not raw.exists() or (args and not PROCESS_ONLY):
            if PROCESS_ONLY: print(f'  {t["id"]}: not generated yet'); continue
            prompt = f'{MANIFEST[t["kind"]]} {t["prompt"]} {MANIFEST["style"]}'
            gt.call([{'text': prompt}], t['id']).save(raw)
        trim(Image.open(raw).convert('RGB')).resize((SHIP, SHIP), Image.LANCZOS).save(OUT / f'{t["id"]}.webp', quality=86)
        print(f'{t["id"]}: done')
    print(f'Spent so far: ${gt.ledger()["spent"]:.3f}')


main()
