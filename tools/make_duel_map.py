#!/usr/bin/env python3
"""Generate public/maps/duel_arena.json (Tiled JSON, 80x60 tiles). Open it in Tiled to edit.
Layers: ground (the dais; the bottom row of each block is the cliff face = blocked), walls (obstacle blocks, blocked),
objects (player/boss spawns, arena zone rect for the camera lock, gate)."""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H, T, COLS = 80, 60, 16, 7

def gid(col, row):
    return row * COLS + col + 1

def plateau(grid, x0, y0, w, h):
    for r in range(h):
        for c in range(w):
            col = 1 if c == 0 else 3 if c == w - 1 else 2
            row = 0 if r == 0 else 2 if r == h - 1 else 1
            grid[y0 + r][x0 + c] = gid(col, row)

def cliff(grid, x0, y0, w, h):
    for r in range(h):
        for c in range(w):
            col = 4 if c == 0 else 6 if c == w - 1 else 5
            row = 0 if r == 0 else 2 if r == h - 1 else 1
            grid[y0 + r][x0 + c] = gid(col, row)

def layer(i, name, grid):
    return {"id": i, "name": name, "type": "tilelayer", "width": W, "height": H, "x": 0, "y": 0, "opacity": 1,
            "visible": True, "data": [v for row in grid for v in row]}

ground = [[0] * W for _ in range(H)]
walls = [[0] * W for _ in range(H)]

DX0, DY0, DW, DH = 4, 3, 72, 54          # the dais
plateau(ground, DX0, DY0, DW, DH)

# divider between the start yard (south) and the arena (north): a tall cliff wall with a 12-tile gate gap
cliff(walls, 5, 30, 29, 4)
cliff(walls, 46, 30, 29, 4)
# arena pillars (raised blocks you can circle) and hall pillars
for (x, y) in [(24, 11), (54, 11), (24, 19), (54, 19)]:
    plateau(walls, x, y, 2, 3)
for (x, y) in [(22, 40), (56, 40), (22, 47), (56, 47)]:
    plateau(walls, x, y, 2, 3)

def pt(i, name, tx, ty, typ="spawn"):
    return {"id": i, "name": name, "type": typ, "x": tx * T, "y": ty * T, "width": 0, "height": 0, "point": True, "rotation": 0, "visible": True}

objects = {"id": 3, "name": "objects", "type": "objectgroup", "draworder": "topdown", "opacity": 1, "visible": True, "x": 0, "y": 0,
           "objects": [pt(1, "player", 40, 51), pt(2, "boss", 40, 14), pt(3, "gate", 40, 32, "gate"), pt(5, "shade", 40, 43), pt(6, "npc", 33, 49),
                       {"id": 4, "name": "arena", "type": "arena", "x": 12 * T, "y": 6 * T, "width": 56 * T, "height": 23 * T,
                        "rotation": 0, "visible": True}]}

m = {"compressionlevel": -1, "width": W, "height": H, "tilewidth": T, "tileheight": T, "infinite": False, "orientation": "orthogonal",
     "renderorder": "right-down", "type": "map", "version": "1.10", "tiledversion": "1.10.2", "nextlayerid": 4, "nextobjectid": 7,
     "layers": [layer(1, "ground", ground), layer(2, "walls", walls), objects],
     "tilesets": [{"firstgid": 1, "name": "duel_tiles", "image": "../duel-assets/tiles/duel_tiles.png", "imagewidth": 112, "imageheight": 48,
                   "tilewidth": T, "tileheight": T, "columns": COLS, "tilecount": 21, "margin": 0, "spacing": 0}]}
os.makedirs(os.path.join(ROOT, "public", "maps"), exist_ok=True)
json.dump(m, open(os.path.join(ROOT, "public", "maps", "duel_arena.json"), "w"))
print("wrote duel_arena.json")
