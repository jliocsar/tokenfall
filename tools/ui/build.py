"""Build the UI skin assets: tinted window frames and web fonts.
Usage: uv run --with pillow --with 'fonttools[woff]' python -I build.py <skin.json> <kenney borders dir> <pixel operator dir> <alegreya dir> <assets dir>
Each frame stacks a Kenney panel shape filled with the panel colour under the matching
border drawn in the frame colour, so CSS border-image can draw it with `fill`.
Fonts become woff2: Pixel Operator whole, Alegreya subset to Latin."""
import json, os, sys
from PIL import Image
from fontTools import subset

skin_path, kenney, pixel, alegreya, out = sys.argv[1:6]
skin = json.load(open(skin_path))


def rgba(value):
    value = value.lstrip('#')
    return tuple(int(value[i:i + 2], 16) for i in range(0, len(value), 2))


def tinted(mask, colour):
    alpha = mask.getchannel('A') if mask.mode == 'RGBA' else mask.convert('L')
    layer = Image.new('RGBA', mask.size, colour[:3] + (0,))
    layer.putalpha(alpha.point(lambda v: colour[3] if v >= 128 else 0))
    return layer


os.makedirs(os.path.join(out, 'ui'), exist_ok=True)
for frame in skin['frames']:
    shape = Image.open(os.path.join(kenney, 'PNG/Default/Panel', f"panel-{frame['kenney']}.png")).convert('RGBA')
    border = Image.open(os.path.join(kenney, 'PNG/Default/Border', f"panel-border-{frame['kenney']}.png")).convert('RGBA')
    image = tinted(shape, rgba(skin['panel']))
    image.alpha_composite(tinted(border, rgba(frame['color'])))
    image.save(os.path.join(out, 'ui', f"frame-{frame['name']}.png"), optimize=True)
    print('frame', frame['name'])

os.makedirs(os.path.join(out, 'fonts'), exist_ok=True)
for name in ['PixelOperator', 'PixelOperator-Bold']:
    font = subset.load_font(os.path.join(pixel, name + '.ttf'), subset.Options())
    font.flavor = 'woff2'
    font.save(os.path.join(out, 'fonts', name + '.woff2'))
    print('font', name)

options = subset.Options()
options.flavor = 'woff2'
options.layout_features = ['*']
for source, target in [('Alegreya[wght].ttf', 'Alegreya.woff2'), ('Alegreya-Italic[wght].ttf', 'Alegreya-Italic.woff2')]:
    font = subset.load_font(os.path.join(alegreya, source), options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=list(range(0x20, 0x7F)) + list(range(0xA0, 0x180)) + list(range(0x2010, 0x2027)) + [0x2122, 0x20AC])
    subsetter.subset(font)
    subset.save_font(font, os.path.join(out, 'fonts', target), options)
    print('font', target)
