import json, os, sys
from PIL import Image
out, dst = sys.argv[1:3]
Z = 3
names = ['knight', 'rogue']
rows = [('knight', 'NE'), ('rogue', 'SE'), ('knight', 'S')]
C = 128
c = Image.new('RGBA', (C * 8, C * len(rows)), (38, 34, 32, 255))
for r, (n, d) in enumerate(rows):
    sh = Image.open(os.path.join(out, 'sheets', f'{n}_pixel.png'))
    m = json.load(open(os.path.join(out, 'sheets', f'{n}.json')))
    for i, f in enumerate(m['animations']['Walking_A'][d]):
        cell = sh.crop((f['x'], f['y'], f['x'] + C, f['y'] + C))
        c.alpha_composite(cell, (i * C, r * C))
c.resize((c.width, c.height), Image.NEAREST).convert('RGB').save(dst)
