# Sprite pipeline

Headless Blender 5.2 renders KayKit models into 8-direction sheets with a 2:1 orthographic camera, 128 px cells, pivot `[64, 102]`.

1. `scripts/fetch.sh` downloads the KayKit packs. They stay out of git; their output doesn't.
2. `scripts/run_final.sh` renders each hero in `heroes/*.json` through `render.py` and `pack.py`.
3. Copy the `_pixel` sheets into `assets/sprites/heroes/<name>.png` and `.json`.
4. Pack the atlas the game loads:

```sh
python3 -I tools/sprites/scripts/atlas.py assets/sprites/heroes assets/sprites/heroes-atlas barbarian knight knight_teal mage rogue stranger
```

## Skeletons

`horde/*.json` renders the four KayKit Skeletons into `horde-atlas`, sheet per kind in the order of `data/combat.json` `monsters` (minion first: the Death Scene horde uses sheet 0). Two config keys help here:

- `attach`: loose props such as weapons and shields, each hung on a rig bone (`handslot.r`, `handslot.l`).
- `rename`: renders a clip under another name. Every sheet in an atlas needs the same clip names, so each kind's own attack and each Hero class's own attack are all named `Attack`.

Tints per Depth Tier aren't rendered: the game multiplies by `data/combat.json` `tints`.

```sh
python3 -I tools/sprites/scripts/atlas.py assets/sprites/horde assets/sprites/horde-atlas skeleton_minion skeleton_warrior skeleton_rogue skeleton_mage
```

The scripts came from the M0 spike and still assume its folder layout. Check paths at the top of `run_final.sh` before running it.

## Props

Town props are single-direction renders packed under the hero cells of `heroes-atlas.png`, so Heroes and props share one texture and sort together.

1. Download the packs listed in `assets/CREDITS.md` into `tmp/asset-research/` (the paths in `props.json` point there).
2. Render. Sizes come from presets, not per-model scales. Each prop names a `preset` in `props.json`, and `presets` gives its height in Hero heights (a house is 3, a tree 4.5, a fence 1.4). `heroHeight` is a Hero's height in Blender units, measured off the atlas: about 48 px above the pivot at 25.6 px per unit. The renderer reads each model's bounding box and scales it to `preset × heroHeight`, so props from any pack land on the Heroes' scale. To add a prop, give it an existing preset, or add a preset if it's a new kind of thing. A `scale` field still works for a prop with no preset.

```sh
cd tools/sprites/scripts && blender -b --factory-startup --disable-autoexec -P render.py -- <props.json with absolute paths>
```

3. Pack the band. It replaces any earlier band, so rerunning is safe:

```sh
python3 -I tools/sprites/scripts/props_pack.py tools/sprites/props.json tmp/sprites/props/raw assets/sprites/heroes-atlas
```

Rerun step 3 after rebuilding the hero atlas with `atlas.py`, since that drops the band.
