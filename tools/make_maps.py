#!/usr/bin/env python3
"""Generate the Tiled arena maps (public/maps/arena_N.json). Open them in Tiled to edit by hand.
Layers: ground (solid), platforms (one-way, from below), spawns (object layer).
Tile ids use firstgid=1 over game-assets/tiles/arena_tiles.png (4 cols x 3 rows, see prep_assets.py)."""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H, T = 40, 23, 16
G = dict(top_left=1, top=2, top_right=3, left=5, mid=6, right=7, bot_left=9, bot=10, bot_right=11)
FLOOR_ROW = 19


def block(grid, c0, c1, r0, r1):
    """Fill a rectangular block with the 9-slice tiles (top row grass, bottom row cap)."""
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            row = "top" if r == r0 else "bot" if r == r1 else "mid"
            col = "_left" if c == c0 else "_right" if c == c1 else ""
            name = {"top": "top", "mid": "", "bot": "bot"}[row]
            if row == "mid":
                name = {"": "mid", "_left": "left", "_right": "right"}[col]
            else:
                name = name if not col else name + col
                if name in ("top_left", "top_right", "bot_left", "bot_right"):
                    pass
            grid[r][c] = G[name]


def layer(i, name, data, **kw):
    return {"id": i, "name": name, "type": "tilelayer", "width": W, "height": H, "x": 0, "y": 0,
            "opacity": 1, "visible": True, "data": [v for row in data for v in row], **kw}


def build(n, platforms):
    ground = [[0] * W for _ in range(H)]
    block(ground, 0, W - 1, FLOOR_ROW, H - 1)
    plat = [[0] * W for _ in range(H)]
    for (c0, c1, r) in platforms:
        block(plat, c0, c1, r, r + 1)
    spawns = {"id": 3, "name": "spawns", "type": "objectgroup", "draworder": "topdown", "opacity": 1, "visible": True, "x": 0, "y": 0,
              "objects": [
                  {"id": 1, "name": "player", "type": "spawn", "x": 6 * T, "y": FLOOR_ROW * T, "width": 0, "height": 0, "point": True, "rotation": 0, "visible": True},
                  {"id": 2, "name": "boss", "type": "spawn", "x": 33 * T, "y": FLOOR_ROW * T, "width": 0, "height": 0, "point": True, "rotation": 0, "visible": True},
              ]}
    return {
        "compressionlevel": -1, "width": W, "height": H, "tilewidth": T, "tileheight": T, "infinite": False,
        "orientation": "orthogonal", "renderorder": "right-down", "type": "map", "version": "1.10", "tiledversion": "1.10.2",
        "nextlayerid": 4, "nextobjectid": 3,
        "layers": [layer(1, "ground", ground), layer(2, "platforms", plat), spawns],
        "tilesets": [{"firstgid": 1, "name": "arena_tiles", "image": "../game-assets/tiles/arena_tiles.png", "imagewidth": 64, "imageheight": 48,
                      "tilewidth": T, "tileheight": T, "columns": 4, "tilecount": 12, "margin": 0, "spacing": 0}],
        "properties": [{"name": "arena", "type": "int", "value": n}],
    }


ARENAS = {
    1: [(6, 9, 14), (30, 33, 14)],                           # slime: two small ledges
    2: [(16, 23, 15), (3, 6, 11), (33, 36, 11)],              # worm: center slab + high ledges
    3: [(14, 25, 16), (6, 11, 12), (28, 33, 12)],             # wizard/bringer: tiered
}
os.makedirs(os.path.join(ROOT, "public", "maps"), exist_ok=True)
for n, plats in ARENAS.items():
    json.dump(build(n, plats), open(os.path.join(ROOT, "public", "maps", f"arena_{n}.json"), "w"))
    print("wrote arena", n)
