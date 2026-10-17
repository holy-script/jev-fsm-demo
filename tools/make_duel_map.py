#!/usr/bin/env python3
"""Generate the Tiled maps (public/maps/*.json, 80x60 tiles). Open them in Tiled to edit.
Layers: ground (the dais; the bottom row of each block is the cliff face = blocked), walls (obstacle blocks, blocked),
objects (spawns, gate, arena rect for the camera lock, lights, shrines, lore stones)."""
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

class Ids:
    n = 0
    @classmethod
    def next(cls):
        cls.n += 1
        return cls.n

def pt(name, tx, ty, typ="spawn", **props):
    o = {"id": Ids.next(), "name": name, "type": typ, "x": tx * T, "y": ty * T, "width": 0, "height": 0, "point": True, "rotation": 0, "visible": True}
    if props:
        o["properties"] = [{"name": k, "type": "string" if isinstance(v, str) else "float", "value": v} for k, v in props.items()]
    return o

def build(name, dais, dividers, pillars, spawns, gate, arena, lights, shrines, lore):
    Ids.n = 0
    ground = [[0] * W for _ in range(H)]
    walls = [[0] * W for _ in range(H)]
    plateau(ground, *dais)
    for (x, y, w, h) in dividers:
        cliff(walls, x, y, w, h)
    for (x, y) in pillars:
        plateau(walls, x, y, 2, 3)
    objs = [pt(n, x, y) for n, (x, y) in spawns.items()]
    objs.append(pt("gate", gate[0], gate[1], "gate"))
    ax, ay, aw, ah = arena
    objs.append({"id": Ids.next(), "name": "arena", "type": "arena", "x": ax * T, "y": ay * T, "width": aw * T, "height": ah * T, "rotation": 0, "visible": True})
    for (x, y, r, color) in lights:
        objs.append(pt("light", x, y, "light", radius=r, color=color))
    for i, (x, y) in enumerate(shrines):
        objs.append(pt(f"shrine{i}", x, y, "shrine"))
    for i, (x, y, text) in enumerate(lore):
        objs.append(pt(f"lore{i}", x, y, "lore", text=text))
    objgroup = {"id": 3, "name": "objects", "type": "objectgroup", "draworder": "topdown", "opacity": 1, "visible": True, "x": 0, "y": 0, "objects": objs}
    return {"compressionlevel": -1, "width": W, "height": H, "tilewidth": T, "tileheight": T, "infinite": False, "orientation": "orthogonal",
            "renderorder": "right-down", "type": "map", "version": "1.10", "tiledversion": "1.10.2", "nextlayerid": 4, "nextobjectid": Ids.n + 1,
            "layers": [layer(1, "ground", ground), layer(2, "walls", walls), objgroup],
            "tilesets": [{"firstgid": 1, "name": "duel_tiles", "image": "../duel-assets/tiles/duel_tiles.png", "imagewidth": 112, "imageheight": 48,
                          "tilewidth": T, "tileheight": T, "columns": COLS, "tilecount": 21, "margin": 0, "spacing": 0}]}

MAPS = {}

# ---- The Hollow Monastery: courtyard (south, the tutorial) and the Hall of Spears (north, grunts and the Captain)
MAPS["duel_arena"] = build(
    "monastery",
    dais=(4, 3, 72, 54),
    dividers=[(5, 30, 29, 4), (46, 30, 29, 4)],
    pillars=[(24, 11), (54, 11), (24, 19), (54, 19), (22, 40), (56, 40), (22, 47), (56, 47)],
    spawns={"player": (40, 51), "boss": (40, 14), "shade": (40, 43), "npc": (33, 49)},
    gate=(40, 32), arena=(12, 6, 56, 23),
    lights=[(25, 10, 170, "#ffb060"), (55, 10, 170, "#ffb060"), (25, 18, 170, "#ffb060"), (55, 18, 170, "#ffb060"), (40, 5, 200, "#ffd9a0"),
            (23, 39, 150, "#ffb060"), (57, 39, 150, "#ffb060"), (23, 46, 150, "#ffb060"), (57, 46, 150, "#ffb060"), (40, 36, 170, "#ffd9a0")],
    shrines=[(47, 51)],
    lore=[(30, 53, "THE HOLLOW MONASTERY. Once ten thousand blades were drawn here in the name of the Peaceful Edge."),
          (49, 40, "Scratched into the stone: 'The Reaper does not kill. The Reaper only waits for us to forget how to dance.'"),
          (40, 26, "A rack of broken spears. Beyond, the Hall of Spears, where the guard still stands, though no one is left to guard.")],
)

# ---- The Foundry: a long iron approach, the Stone Heart at the end
MAPS["foundry"] = build(
    "foundry",
    dais=(8, 4, 64, 54),
    dividers=[(9, 32, 25, 4), (46, 32, 25, 4), (20, 22, 6, 2), (54, 22, 6, 2)],
    pillars=[(18, 10), (60, 10), (30, 14), (48, 14), (24, 24), (54, 24), (28, 42), (50, 42)],
    spawns={"player": (40, 52), "boss": (40, 13), "shade": (40, 44), "npc": (33, 50)},
    gate=(40, 34), arena=(14, 7, 52, 25),
    lights=[(19, 9, 170, "#ff7a2a"), (61, 9, 170, "#ff7a2a"), (31, 13, 150, "#ff7a2a"), (49, 13, 150, "#ff7a2a"), (40, 6, 220, "#ff5a1a"),
            (29, 41, 150, "#ff8a3a"), (51, 41, 150, "#ff8a3a"), (40, 37, 190, "#ffb060")],
    shrines=[(47, 52)],
    lore=[(34, 53, "THE FOUNDRY. They cast the Stone Heart here to guard the way up, and forged it so well that it forgot what it guarded."),
          (50, 46, "'It will not tire. It will not flinch. It will, however, break against a patient hand.' - the foundry master's last note.")],
)

# ---- The Summit: open sky, a ring of pillars, the Reaper's ground
MAPS["summit"] = build(
    "summit",
    dais=(6, 5, 68, 52),
    dividers=[(7, 40, 28, 3), (45, 40, 28, 3)],
    pillars=[(18, 12), (60, 12), (26, 20), (52, 20), (18, 28), (60, 28), (30, 8), (48, 8)],
    spawns={"player": (40, 51), "boss": (40, 16), "shade": (40, 45), "npc": (33, 49)},
    gate=(40, 41), arena=(10, 7, 60, 31),
    lights=[(19, 11, 150, "#9fb8ff"), (61, 11, 150, "#9fb8ff"), (27, 19, 140, "#9fb8ff"), (53, 19, 140, "#9fb8ff"), (40, 12, 260, "#c8d6ff"), (40, 46, 170, "#9fb8ff")],
    shrines=[(46, 51)],
    lore=[(34, 53, "THE SUMMIT. The wind here sounds like a blade being drawn, over and over, by no one."),
          (40, 44, "At last. The Reaper waits at the top of every story. It has been waiting a very long time.")],
)

os.makedirs(os.path.join(ROOT, "public", "maps"), exist_ok=True)
for name, m in MAPS.items():
    json.dump(m, open(os.path.join(ROOT, "public", "maps", name + ".json"), "w"))
    print("wrote", name + ".json")
