"""Composites sprites into a test room with a Diablo-ish light radius, plus a contact sheet
and a walking animation. Usage: compose.py <out_root>"""
import json, math, os, random, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]
PPU = 25.6
K = 0.7071 * PPU
DIRS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW']
T = os.path.join(OUT, 'raw', 'tiles')
tile = {f[:-4]: Image.open(os.path.join(T, f)).convert('RGBA').resize((256, 256), Image.BOX) for f in os.listdir(T)}
TP = (128, 179)  # tile pivot
W, H = 960, 640
OX, OY = W // 2, 400


def scr(lx, ly, z=0):
    return OX + (lx - ly) * K, OY - (lx + ly) * K * 0.5 - z * 0.866 * PPU


class Hero:
    def __init__(s, name):
        s.sheet = Image.open(os.path.join(OUT, 'sheets', f'{name}_pixel.png'))
        s.clean = Image.open(os.path.join(OUT, 'sheets', f'{name}.png'))
        s.meta = json.load(open(os.path.join(OUT, 'sheets', f'{name}.json')))

    def frame(s, anim, d, i, clean=False):
        fr = s.meta['animations'][anim][d]
        f = fr[i % len(fr)]
        c = s.meta['cell'][0]
        return (s.clean if clean else s.sheet).crop((f['x'], f['y'], f['x'] + c, f['y'] + c))


def static_room(seed=7):
    r = random.Random(seed)
    bg = Image.new('RGBA', (W, H), (0, 0, 0, 255))
    fl = ['floor_tile_small'] * 7 + ['floor_tile_small_broken_A', 'floor_tile_small_broken_B', 'floor_tile_small_weeds_A', 'floor_dirt_small_A']
    coords = [(lx, ly) for lx in range(-9, 10, 2) for ly in range(-9, 10, 2)]
    for lx, ly in sorted(coords, key=lambda c: -(c[0] + c[1])):
        im = tile[r.choice(fl)]
        x, y = scr(lx, ly)
        bg.alpha_composite(im, (round(x - TP[0]), round(y - TP[1])))
    items = []
    for lx in (-8, -4, 0, 4, 8):
        items.append(('wall' if lx != -4 else 'wall_arched', lx, 10.5, 0))
    for ly in (-8, -4, 0, 4, 8):
        items.append(('wall_r90' if ly != 4 else 'wall_broken_r90', 10.5, ly, 0))
    items.append(('pillar', -4, -4, 0))
    items.append(('barrel_large', 7, 7, 0))
    items.append(('barrel_small_stack', -7, 7.5, 0))
    items.append(('chest', 7, -6, 0))
    return bg, items


TORCHES = [('torch_mounted', 0, 10, 2.4), ('torch_mounted', 8, 10, 2.4), ('torch_mounted_rm90', 10, 0, 2.4), ('torch_mounted_rm90', 10, -8, 2.4)]


def light(frame_rgba, t, hero_pos):
    a = np.asarray(frame_rgba.convert('RGB'), dtype=np.float32) / 255
    yy, xx = np.mgrid[0:H, 0:W]
    m = np.full((H, W), 0.10, dtype=np.float32)
    warm = np.zeros((H, W), dtype=np.float32)
    for i, (_, lx, ly, z) in enumerate(TORCHES):
        x, y = scr(lx, ly, z)
        fl = 1 + 0.06 * math.sin(t * 1.7 + i * 2.1)
        d = np.hypot(xx - x, (yy - y) * 1.6) / (230 * fl)
        g = np.clip(1 - d, 0, 1) ** 1.7
        m += g * 0.95
        warm += g
    for (x, y) in hero_pos:  # each hero carries a small light radius, like Diablo
        d = np.hypot(xx - x, (yy - y + 25) * 1.5) / 150
        m += np.clip(1 - d, 0, 1) ** 1.6 * 0.75
    m = np.clip(m, 0, 1.25)[..., None]
    warm = np.clip(warm, 0, 1)[..., None]
    tintc = np.array([1.0, 0.83, 0.62], dtype=np.float32)
    col = a * m * (1 + warm * (tintc - 1))
    # slight desat in the shadows, keeps the grim look
    lum = col.mean(axis=2, keepdims=True)
    col = lum + (col - lum) * 0.85
    return Image.fromarray(np.uint8(np.clip(col, 0, 1) * 255), 'RGB')


def shadow(canvas, x, y):
    s = Image.new('RGBA', (60, 26), (0, 0, 0, 0))
    ImageDraw.Draw(s).ellipse((6, 4, 54, 22), fill=(0, 0, 0, 120))
    canvas.alpha_composite(s, (round(x - 30), round(y - 13)))


def draw_frame(heroes, states, tick, bg, items, grade=True, clean=False):
    c = bg.copy()
    drawn = []
    for (name, lx, ly, _) in items:
        drawn.append((lx + ly, 'item', name, lx, ly, 0))
    for (name, lx, ly, z) in TORCHES:
        drawn.append((lx + ly - 0.1, 'item', name, lx, ly, z))
    pos = []
    for st in states:
        lx, ly, anim, d, spd = st(tick)
        drawn.append((lx + ly, 'hero', (heroes[st.hero], anim, d, spd), lx, ly, 0))
        pos.append(scr(lx, ly))
    for _, kind, a, lx, ly, z in sorted(drawn, key=lambda v: -v[0]):
        x, y = scr(lx, ly, z)
        if kind == 'item':
            c.alpha_composite(tile[a], (round(x - TP[0]), round(y - TP[1])))
        else:
            h, anim, d, spd = a
            shadow(c, x, y)
            cellp = h.meta['pivot']
            c.alpha_composite(h.frame(anim, d, tick // spd, clean), (round(x - cellp[0]), round(y - cellp[1])))
    return light(c, tick, pos) if grade else c.convert('RGB')


def patrol(hero, a, b, d_fwd, d_back, steps):
    def f(t):
        p = t % (2 * steps)
        if p < steps:
            k, d = p / steps, d_fwd
        else:
            k, d = (p - steps) / steps, d_back
            a_, b_ = b, a
            return a_[0] + (b_[0] - a_[0]) * k, a_[1] + (b_[1] - a_[1]) * k, 'Walking_A', d, 1
        return a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, 'Walking_A', d, 1
    f.hero = hero
    return f


def idle(hero, lx, ly, d):
    def f(t):
        return lx, ly, 'Idle', d, 3
    f.hero = hero
    return f


names = [n for n in ['knight', 'knight_teal', 'mage', 'rogue', 'barbarian'] if os.path.exists(os.path.join(OUT, 'sheets', f'{n}.png'))]
heroes = {n: Hero(n) for n in names}
bg, items = static_room()
STEPS = 24
states = [
    patrol('knight', (-5, 2), (3, 2), 'NE', 'SW', STEPS),
    patrol('rogue', (1, 7), (1, -3), 'SE', 'NW', STEPS),
    patrol('barbarian', (-6, -7), (2, -7), 'NE', 'SW', STEPS),
    idle('mage', 4, 5, 'SW'),
    idle('knight_teal', 5, -3, 'W'),
]
states = [s for s in states if s.hero in heroes]

still = draw_frame(heroes, states, 6, bg, items)
still.save(os.path.join(OUT, 'scene_graded.png'))
raw_clean = draw_frame(heroes, states, 6, bg, items, grade=False, clean=True)
raw_clean.save(os.path.join(OUT, 'scene_clean.png'))

# animation
frames_dir = os.path.join(OUT, 'anim_frames')
os.makedirs(frames_dir, exist_ok=True)
for t in range(2 * STEPS):
    draw_frame(heroes, states, t, bg, items).save(os.path.join(frames_dir, f'{t:03d}.png'))
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '12', '-i', os.path.join(frames_dir, '%03d.png'),
                '-vf', 'split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=none', '-loop', '0', os.path.join(OUT, 'scene_walk.gif')], check=True)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-stream_loop', '3', '-framerate', '12', '-i', os.path.join(frames_dir, '%03d.png'),
                '-vf', 'scale=iw*2:ih*2:flags=neighbor', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', os.path.join(OUT, 'scene_walk.mp4')], check=True)

# contact sheet: every hero, 8 directions, hard-alpha pixel flavor
CW = 128
labels = ['knight', 'knight_teal', 'mage', 'rogue', 'barbarian']
rows = [n for n in labels if n in heroes]
extra = os.path.exists(os.path.join(OUT, 'sheets', 'knight_states.png'))
sheet = Image.new('RGBA', (CW * 8 + 110, CW * len(rows) + (CW + 26 if extra else 0) + 30), (38, 34, 32, 255))
d = ImageDraw.Draw(sheet)
for i, dn in enumerate(DIRS):
    d.text((110 + i * CW + 55, 8), dn, fill=(220, 210, 190, 255))
for r, n in enumerate(rows):
    y = 30 + r * CW
    d.text((8, y + 56), n, fill=(220, 210, 190, 255))
    for i, dn in enumerate(DIRS):
        sheet.alpha_composite(heroes[n].frame('Walking_A', dn, 2), (110 + i * CW, y))
if extra:
    st = Hero('knight_states')
    y = 30 + len(rows) * CW
    d.text((8, y + 8), 'states (knight SE)', fill=(220, 210, 190, 255))
    for i, a in enumerate(['Sit_Floor_Idle', 'Spellcasting', 'Interact', 'Hit_A', 'Death_A', 'Cheer']):
        fr = st.meta['animations'][a]['SE']
        d.text((110 + i * CW + 20, y + 8), a, fill=(220, 210, 190, 255))
        sheet.alpha_composite(st.frame(a, 'SE', len(fr) // 2 if a != 'Death_A' else len(fr) - 1), (110 + i * CW, y + 20))
sheet.convert('RGB').save(os.path.join(OUT, 'contact_sheet.png'))
print('ok', list(heroes))
