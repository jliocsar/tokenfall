"""Append rendered props to the game atlas as a band under the hero cells.
Usage: python3 -I props_pack.py <props.json> <raw dir> <atlas base path>
Each prop is downscaled from the supersampled render, given hard alpha and its own
64-colour palette like the heroes, trimmed, and shelf-packed. The atlas JSON gets
`props: {name: [x, y, w, h, pivotX, pivotY]}` and `heroesHeight`, so a rerun replaces
the band instead of stacking another one."""
import json, os, sys
from PIL import Image

cfg_path, raw, base = sys.argv[1:4]
cfg = json.load(open(cfg_path))
CELL = cfg['cell']
PIVOT = (CELL // 2, round(CELL * cfg['pivot_y']))
GAP = 2
COLORS = 64

meta = json.load(open(base + '.json'))
atlas = Image.open(base + '.png').convert('RGBA')
heroes_height = meta.get('heroesHeight', atlas.height)
atlas = atlas.crop((0, 0, atlas.width, heroes_height))

pieces = []
for item in cfg['tiles']:
    im = Image.open(os.path.join(raw, item['name'] + '.png')).convert('RGBA').resize((CELL, CELL), Image.BOX)
    alpha = im.getchannel('A').point(lambda v: 255 if v >= 110 else 0)
    rgb = im.convert('RGB').quantize(colors=COLORS, method=Image.Quantize.MAXCOVERAGE, dither=Image.Dither.NONE).convert('RGB')
    rgb.putalpha(alpha)
    box = alpha.getbbox()
    if box is None:
        print('EMPTY', item['name'])
        continue
    pieces.append((item['name'], rgb.crop(box), PIVOT[0] - box[0], PIVOT[1] - box[1]))

pieces.sort(key=lambda piece: -piece[1].height)
placed = {}
x = y = row = 0
for name, im, px, py in pieces:
    if x + im.width > atlas.width:
        x, y, row = 0, y + row + GAP, 0
    placed[name] = (x, y, im, px, py)
    x += im.width + GAP
    row = max(row, im.height)
band = y + row

out = Image.new('RGBA', (atlas.width, heroes_height + band), (0, 0, 0, 0))
out.paste(atlas, (0, 0))
props = {}
for name, (px_, py_, im, pivot_x, pivot_y) in placed.items():
    out.paste(im, (px_, heroes_height + py_))
    props[name] = [px_, heroes_height + py_, im.width, im.height, pivot_x, pivot_y]

meta['heroesHeight'] = heroes_height
meta['props'] = props
out.save(base + '.png', optimize=True)
json.dump(meta, open(base + '.json', 'w'), separators=(',', ':'))
print('props', len(props), 'band', band, 'atlas', out.size)
