"""Downscale raw frames, pack into a spritesheet plus JSON. Two flavors: clean (smooth alpha)
and pixel (hard alpha, palette quantized). Usage: pack.py <out_root> <hero> [--colors N]"""
import json, os, re, sys
from collections import defaultdict
from PIL import Image

out, hero = sys.argv[1:3]
colors = int(sys.argv[sys.argv.index('--colors') + 1]) if '--colors' in sys.argv else 48
raw = os.path.join(out, 'raw', hero)
DIRS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW']
CELL = 128
files = defaultdict(lambda: defaultdict(dict))
for f in os.listdir(raw):
    m = re.match(r'(.+)_d(\d)_f(\d+)\.png', f)
    if m:
        files[m[1]][int(m[2])][int(m[3])] = f
rows = [(a, d) for a in sorted(files, key=lambda a: (a != 'Idle', a)) for d in sorted(files[a])]
cols = max(len(files[a][d]) for a, d in rows)
sheet = Image.new('RGBA', (cols * CELL, len(rows) * CELL), (0, 0, 0, 0))
meta = {'hero': hero, 'cell': [CELL, CELL], 'pivot': [CELL // 2, round(CELL * 0.8)], 'ppu': 25.6,
        'projection': '2:1 dimetric, ortho, 60deg from vertical',
        'source': 'KayKit Adventurers Character Pack 1.0, Kay Lousberg, CC0',
        'animations': {}}
for r, (a, d) in enumerate(rows):
    fr = []
    for c, k in enumerate(sorted(files[a][d])):
        im = Image.open(os.path.join(raw, files[a][d][k])).convert('RGBA').resize((CELL, CELL), Image.BOX)
        sheet.paste(im, (c * CELL, r * CELL))
        fr.append({'x': c * CELL, 'y': r * CELL})
    meta['animations'].setdefault(a, {})[DIRS[d]] = fr
os.makedirs(os.path.join(out, 'sheets'), exist_ok=True)
sheet.save(os.path.join(out, 'sheets', f'{hero}.png'), optimize=True)
json.dump(meta, open(os.path.join(out, 'sheets', f'{hero}.json'), 'w'), indent=1)
# pixel flavor: hard alpha, shared palette across the sheet, no dithering
alpha = sheet.getchannel('A').point(lambda v: 255 if v >= 110 else 0)
rgb = sheet.convert('RGB').quantize(colors=colors, method=Image.Quantize.MAXCOVERAGE, dither=Image.Dither.NONE).convert('RGB')
rgb.putalpha(alpha)
rgb.save(os.path.join(out, 'sheets', f'{hero}_pixel.png'), optimize=True)
print(hero, sheet.size, 'frames', sum(len(files[a][d]) for a, d in rows), 'colors', colors)
