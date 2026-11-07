# Sprite pipeline

Headless Blender 5.2 renders KayKit models into 8-direction sheets with a 2:1 orthographic camera, 128 px cells, pivot `[64, 102]`.

1. `scripts/fetch.sh` downloads the KayKit packs. They stay out of git; their output doesn't.
2. `scripts/run_final.sh` renders each hero in `heroes/*.json` through `render.py` and `pack.py`.
3. Copy the `_pixel` sheets into `assets/sprites/heroes/<name>.png` and `.json`.
4. Pack the atlas the game loads:

```sh
python3 -I tools/sprites/scripts/atlas.py assets/sprites/heroes assets/sprites/heroes-atlas barbarian knight knight_teal mage rogue
```

The scripts came from the M0 spike and still assume its folder layout. Check paths at the top of `run_final.sh` before running it.
