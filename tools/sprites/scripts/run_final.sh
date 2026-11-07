#!/bin/bash
cd /home/jliocsar/Projects/claude-agents-visualizer/tmp/sprites/scripts
python3 -I patch_cfg.py
rm -rf ../out/raw/knight_crimson ../out/sheets/knight_crimson*
BL="nice -n 10 blender -b --factory-startup --disable-autoexec -P render.py --"
for j in tiles tiles_extra hero_knight hero_knight_teal hero_mage hero_rogue hero_barbarian states_knight; do
  $BL $j.json 2>&1 | grep -E '^RENDER|Traceback|Error' | cut -c1-160
done
for h in knight knight_teal mage rogue barbarian knight_states; do python3 -I pack.py /home/jliocsar/Projects/claude-agents-visualizer/tmp/sprites/out $h --colors 64; done
uv run --no-project --isolated --with numpy --with pillow python -I compose.py /home/jliocsar/Projects/claude-agents-visualizer/tmp/sprites/out
echo FINAL_DONE
