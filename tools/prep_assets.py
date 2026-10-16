#!/usr/bin/env python3
"""Turn the raw itch.io packs in assets/packs into game-ready strips + manifest.json.

Output goes to public/game-assets (gitignored: Bringer of Death's licence forbids redistribution).
Run:  python3 tools/prep_assets.py
"""
import glob, json, os, shutil, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKS = os.path.join(ROOT, "assets", "packs")
OUT = os.path.join(ROOT, "public", "game-assets")


def pack(prefix):
    hits = sorted(glob.glob(os.path.join(PACKS, prefix + "*")))
    if not hits:
        sys.exit(f"missing pack '{prefix}' in {PACKS} - run the downloader first (see tools/README.md)")
    return hits[0]


def find(base, *parts):
    """Case-insensitive path join under a pack (pack folders are inconsistent about case)."""
    cur = base
    for part in parts:
        match = [e for e in os.listdir(cur) if e.lower() == part.lower()]
        if not match:
            # pack zips nest one extra folder; descend into the only non-meta dir
            subs = [e for e in os.listdir(cur) if os.path.isdir(os.path.join(cur, e)) and e != "__MACOSX"]
            if len(subs) == 1:
                return find(os.path.join(cur, subs[0]), *parts[parts.index(part):])
            sys.exit(f"cannot find {part} under {cur}: {os.listdir(cur)}")
        cur = os.path.join(cur, match[0])
    return cur


manifest = {"sheets": {}}


def bbox_union(frames):
    box = None
    for f in frames:
        b = f.getbbox()
        if b:
            box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    return box or (0, 0, 1, 1)


def add_strip(key, img, fw, fh, dest):
    n = img.width // fw
    frames = [img.crop((i * fw, 0, (i + 1) * fw, fh)) for i in range(n)]
    os.makedirs(os.path.dirname(os.path.join(OUT, dest)), exist_ok=True)
    img.save(os.path.join(OUT, dest))
    x0, y0, x1, y1 = bbox_union(frames)
    fx0, fy0, fx1, fy1 = bbox_union(frames[:1])
    manifest["sheets"][key] = {
        "file": "game-assets/" + dest, "frameW": fw, "frameH": fh, "frames": n,
        "bbox": {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0},       # union over all frames (reach)
        "body": {"x": fx0, "y": fy0, "w": fx1 - fx0, "h": fy1 - fy0},  # first frame (physics body)
    }


def strip_file(key, path, dest, square=True, fw=None):
    img = Image.open(path).convert("RGBA")
    fw = fw or (img.height if square else img.width)
    add_strip(key, img, fw, img.height, dest)


def strip_folder(key, folder, dest):
    files = sorted(glob.glob(os.path.join(folder, "*.png")), key=lambda p: int(os.path.splitext(p)[0].rsplit("_", 1)[-1]))
    imgs = [Image.open(f).convert("RGBA") for f in files]
    fw, fh = imgs[0].size
    sheet = Image.new("RGBA", (fw * len(imgs), fh))
    for i, im in enumerate(imgs):
        sheet.paste(im, (i * fw, 0))
    add_strip(key, sheet, fw, fh, dest)


if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)

# ---- player: Hero Knight 2 (CC0, Luiz Melo)
hk = find(pack("hero-knight-2"), "Hero Knight 2", "Sprites")
for k, f in {"Idle": "Idle", "Run": "Run", "Jump": "Jump", "Fall": "Fall", "Attack": "Attack",
             "Dash": "Dash", "TakeHit": "Take Hit", "Death": "Death"}.items():
    strip_file(f"knight_{k}", os.path.join(hk, f + ".png"), f"player/{k}.png")

# ---- boss 1: Slime (Monsters Creatures Fantasy 2, Luiz Melo)
sl = find(pack("monsters-creatures-fantasy-2"), "Monsters Creatures Fantasy 2", "Slime")
for k, f in {"Idle": "idle", "Walk": "walk", "Attack": "attack", "Hurt": "hurt", "Death": "death"}.items():
    strip_file(f"slime_{k}", os.path.join(sl, f + ".png"), f"bosses/slime/{k}.png")

# ---- boss 2: Fire Worm (CC0, Luiz Melo)
fw = find(pack("fire-worm"), "Fire Worm", "Sprites")
for k, f in {"Idle": "Idle", "Walk": "Walk", "Attack": "Attack", "Hurt": "Get Hit", "Death": "Death"}.items():
    strip_file(f"worm_{k}", os.path.join(fw, "Worm", f + ".png"), f"bosses/worm/{k}.png")
strip_file("fx_fireball", os.path.join(fw, "Fire Ball", "Move.png"), "fx/fireball_move.png", square=False, fw=46)
strip_file("fx_fireball_hit", os.path.join(fw, "Fire Ball", "Explosion.png"), "fx/fireball_explode.png", square=False, fw=46)

# ---- boss 3: Evil Wizard 3 (Luiz Melo)
ew = find(pack("evil-wizard-3"), "Evil Wizard 3", "Sprites")
for k, f in {"Idle": "Idle", "Walk": "Walk", "Run": "Run", "Attack": "Attack", "Jump": "Jump",
             "Fall": "Fall", "Hurt": "Get hit", "Death": "Death"}.items():
    strip_file(f"wizard_{k}", os.path.join(ew, f + ".png"), f"bosses/wizard/{k}.png")
strip_file("fx_bolt", os.path.join(ew, "Projectile", "Moving.png"), "fx/bolt_move.png", square=False, fw=50)
strip_file("fx_bolt_hit", os.path.join(ew, "Projectile", "Explode.png"), "fx/bolt_explode.png", square=False, fw=50)

# ---- boss 4: Bringer of Death (Clembod; no redistribution)
bd = find(pack("bringer-of-death-free"), "Bringer-Of-Death", "Individual Sprite")
for k in ["Idle", "Walk", "Attack", "Cast", "Hurt", "Death"]:
    strip_folder(f"bringer_{k}", os.path.join(bd, k), f"bosses/bringer/{k}.png")
strip_folder("fx_spell", os.path.join(bd, "Spell"), "fx/bringer_spell.png")

# ---- environment: Tiny Platformer - Hills (CC0, Luiz Melo)
hills = find(pack("tiny-platformer-hills"), "Tiny Platformer - Hills Asset Pack")
os.makedirs(os.path.join(OUT, "bg"))
for i in range(1, 5):
    shutil.copy(os.path.join(hills, "Background", f"Background layer 0{i}.png"), os.path.join(OUT, "bg", f"layer{i}.png"))
    manifest["sheets"][f"bg{i}"] = {"file": f"game-assets/bg/layer{i}.png", "w": Image.open(os.path.join(OUT, "bg", f"layer{i}.png")).width,
                                    "h": Image.open(os.path.join(OUT, "bg", f"layer{i}.png")).height}

# Re-cut the source tileset (it sits on a 1px offset grid) into a clean 16px-aligned tileset.
src = Image.open(os.path.join(hills, "Tileset(16x16)", "Tileset.png")).convert("RGBA")
T, OFF = 16, 1
# (name, source col, source row) on the offset grid. Layout below is 4 cols x 3 rows.
LAYOUT = [
    ["top_left", "top", "top_right", None],
    ["left", "mid", "right", None],
    ["bot_left", "bot", "bot_right", None],
]
SRC = {"top_left": (2, 1), "top": (3, 1), "top_right": (4, 1),
       "left": (1, 3), "mid": (3, 3), "right": (5, 3),
       "bot_left": (2, 5), "bot": (3, 5), "bot_right": (4, 5)}
tiles = Image.new("RGBA", (4 * T, 3 * T))
names = {}
for r, row in enumerate(LAYOUT):
    for c, n in enumerate(row):
        if not n:
            continue
        sc, sr = SRC[n]
        tiles.paste(src.crop((OFF + sc * T, OFF + sr * T, OFF + (sc + 1) * T, OFF + (sr + 1) * T)), (c * T, r * T))
        names[n] = r * 4 + c + 1  # Tiled gid (firstgid=1)
os.makedirs(os.path.join(OUT, "tiles"))
tiles.save(os.path.join(OUT, "tiles", "arena_tiles.png"))
manifest["tiles"] = {"file": "game-assets/tiles/arena_tiles.png", "tile": T, "columns": 4, "rows": 3, "gid": names}

json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), indent=1)
print(f"ok: {len(manifest['sheets'])} sheets -> {OUT}")
