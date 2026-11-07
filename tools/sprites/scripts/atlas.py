import json
import sys
from pathlib import Path

from PIL import Image

source = Path(sys.argv[1])
target = Path(sys.argv[2])
names = sys.argv[3:]
sheets = [json.loads((source / f"{name}.json").read_text()) for name in names]
images = [Image.open(source / f"{name}.png").convert("RGBA") for name in names]
width = sum(image.width for image in images)
height = max(image.height for image in images)
atlas = Image.new("RGBA", (width, height))
directions = list(sheets[0]["animations"]["Idle"].keys())
animations = list(sheets[0]["animations"].keys())
frames = []
offset = 0

for name, sheet, image in zip(names, sheets, images):
    atlas.paste(image, (offset, 0))
    per_animation = []

    for animation in animations:
        per_direction = []

        for direction in directions:
            cells = sheet["animations"][animation][direction]
            per_direction.append([[cell["x"] + offset, cell["y"]] for cell in cells])

        per_animation.append(per_direction)

    frames.append(per_animation)
    offset += image.width

atlas.save(target.with_suffix(".png"), optimize=True)
target.with_suffix(".json").write_text(
    json.dumps(
        {
            "image": target.with_suffix(".png").name,
            "cell": sheets[0]["cell"],
            "pivot": sheets[0]["pivot"],
            "sheets": names,
            "animations": [
                {"name": animation, "frames": len(sheets[0]["animations"][animation][directions[0]])}
                for animation in animations
            ],
            "directions": directions,
            "cells": frames,
            "source": sheets[0]["source"],
        },
        separators=(",", ":"),
    )
)
print(f"{target.with_suffix('.png')} {width}x{height}, {len(names)} sheets")
