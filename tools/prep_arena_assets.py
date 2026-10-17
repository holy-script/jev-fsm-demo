#!/usr/bin/env python3
"""Build public/arena-assets from the packs in assets/packs4 (chierit characters, pimen VFX, immunitys tiles/UI/icons).
Run:  python3 -I tools/prep_arena_assets.py      (output is gitignored: third-party art; see docs/09-v4-plan.md)

manifest.json: {"sheets": {key: {file, frameW, frameH, frames, bbox, first}}, "vfx": {key: {...same, "auto": bool}}, "raw": {...}}
Character keys are "<prefix>_<anim>" with the pack's numeric ordering prefix removed ("05_1_atk" -> "fk_1_atk")."""
import glob, json, os, re, shutil, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P4 = os.path.join(ROOT, "assets", "packs4")
OUT = os.path.join(ROOT, "public", "arena-assets")

def nat(p):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", os.path.basename(p))]

if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)
man = {"sheets": {}, "vfx": {}, "raw": {}}

def slug(s):
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")

def info(imgs, dest, fw, fh, extra=None):
    boxes = [b for b in (i.getbbox() for i in imgs) if b]
    d = {"file": "arena-assets/" + dest, "frameW": fw, "frameH": fh, "frames": len(imgs),
         "bbox": [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)] if boxes else [0, 0, fw, fh],
         "first": list(imgs[0].getbbox() or (0, 0, fw, fh))}
    if extra:
        d.update(extra)
    return d

def save_strip(imgs, dest):
    fw, fh = imgs[0].size
    sheet = Image.new("RGBA", (fw * len(imgs), fh))
    for i, im in enumerate(imgs):
        sheet.paste(im, (i * fw, 0))
    os.makedirs(os.path.dirname(os.path.join(OUT, dest)), exist_ok=True)
    sheet.save(os.path.join(OUT, dest))

# ---------------------------------------------------------------- characters
# prefix -> (pack folder, human name). Folders of numbered frames become one strip each.
CHARS = {
    "fk": ("elementals-fire-knight", "Fire Knight"), "mb": ("elementals-metal-bladekeeper", "Metal Bladekeeper"),
    "cm": ("elementals-crystal-mauler", "Crystal Mauler"), "wh": ("elementals-wind-hashashin", "Wind Hashashin"),
    "wp": ("elementals-water-priestess", "Water Priestess"), "gm": ("elementals-ground-monk", "Ground Monk"),
    "lr": ("elementals-leaf-ranger", "Leaf Ranger"), "cth": ("free-cthulu", "Cthulu"),
    "dsl": ("boss-demon-slime", "Demon Slime"), "fg": ("boss-frost-guardian", "Frost Guardian"),
}
man["chars"] = {k: v[1] for k, v in CHARS.items()}

def anim_key(folder):
    k = re.sub(r"^\d\d_", "", os.path.basename(folder).lower())
    k = re.sub(r"^(demon_|cthulu_)", "", k)
    return slug(k)

for prefix, (pack, _) in CHARS.items():
    dirs = {}
    for f in glob.glob(os.path.join(P4, pack, "**", "*.png"), recursive=True):
        if re.search(r"\d+\.png$", f) and "gifs" not in f and "spritesheet" not in f.lower():
            dirs.setdefault(os.path.dirname(f), []).append(f)
    if not dirs:
        sys.exit(f"no frames for {pack}")
    for d, fs in sorted(dirs.items()):
        fs.sort(key=nat)
        imgs = [Image.open(f).convert("RGBA") for f in fs]
        if not any(i.getbbox() for i in imgs):
            continue
        key = f"{prefix}_{anim_key(d)}"
        dest = f"chars/{prefix}/{anim_key(d)}.png"
        save_strip(imgs, dest)
        man["sheets"][key] = info(imgs, dest, *imgs[0].size)

# ---------------------------------------------------------------- VFX (pimen): horizontal sheets, frame size must be inferred
def detect_grid(im, hint=None):
    """Cell size (fw, fh) and (cols, rows) of a sprite sheet laid out as a grid (often a single row). Trust order: a "(WxH)" size in
    the file name; otherwise the FINEST cut whose every cell boundary crosses only transparent pixels and whose cells are all non-empty
    (a cut through a drawn frame is never clean, so the finest clean cut is the real frame grid). Returns (fw, fh, cols, rows, confident)."""
    W, H = im.size
    if hint and W % hint[0] == 0 and H % hint[1] == 0:
        return hint[0], hint[1], W // hint[0], H // hint[1], True
    a = im.split()[3]
    colclear = [a.crop((x, 0, x + 1, H)).getbbox() is None for x in range(W)]
    rowclear = [a.crop((0, y, W, y + 1)).getbbox() is None for y in range(H)]

    def clean_counts(size, clear):
        out = []
        for n in range(1, min(64, size // 8) + 1):
            if size % n == 0 and all(clear[k * (size // n) - 1] or clear[k * (size // n)] for k in range(1, n)):
                out.append(n)
        return out

    import math
    ccs = clean_counts(W, colclear)
    cols = max(ccs)
    ok = True
    fw = W // cols
    if fw > H * 2 or (cols == 1 and W > H * 1.5):                     # no clean cut in a wide strip (frames touch): nearest-square divisor
        cols = min((n for n in range(2, 80) if W % n == 0), key=lambda n: abs(W // n - H), default=1)
        fw, ok = W // cols, False
    rcs = clean_counts(H, rowclear)
    rows = min(rcs, key=lambda r: (abs(math.log(fw / (H // r))), r))   # rows: prefer square-ish cells (an empty row inside every frame is common)
    fh = H // rows
    empties = sum(1 for r in range(rows) for c in range(cols) if a.crop((c * fw, r * fh, (c + 1) * fw, (r + 1) * fh)).getbbox() is None)
    return fw, fh, cols, rows, ok and empties <= max(1, cols * rows // 6)

SKIP_VFX = re.compile(r"(192x192|gif|preview|sample|aseprite|separ|\(30 ?fps\)|30fps)", re.I)
count = 0
for pack in sorted(os.listdir(P4)):
    if not os.path.isdir(os.path.join(P4, pack)):
        continue
    if any(pack == p[0] for p in CHARS.values()) or pack in ("fm32x32", "resurected-rpg-tile", "pixel-ui-pack", "icon-pack-24x24", "skeletons-pack-1",
                                                           "skeletons-pack-2", "goblin-sprite-pack", "lively-npcs"):
        continue
    for f in sorted(glob.glob(os.path.join(P4, pack, "**", "*.png"), recursive=True)):
        rel = os.path.relpath(f, os.path.join(P4, pack))
        if SKIP_VFX.search(rel) or re.search(r"\d+\.png$", os.path.basename(f)) and "Separ" in rel:
            continue
        im = Image.open(f).convert("RGBA")
        if not im.getbbox():
            continue
        m = re.search(r"\((\d+)x(\d+)\)", f) or re.search(r"(\d+)x(\d+)", os.path.basename(f))
        fw, fh, cols, rows, ok = detect_grid(im, (int(m.group(1)), int(m.group(2))) if m else None)
        frames = [im.crop((c * fw, r * fh, (c + 1) * fw, (r + 1) * fh)) for r in range(rows) for c in range(cols)]
        frames = [f for f in frames if f.getbbox()] or frames[:1]
        key = slug(pack.replace("-spell-effect", "").replace("-effect", "")) + "_" + slug(os.path.splitext(os.path.basename(f))[0])
        dest = f"vfx/{key}.png"
        os.makedirs(os.path.join(OUT, "vfx"), exist_ok=True)
        im.save(os.path.join(OUT, dest))
        man["vfx"][key] = info(frames, dest, fw, fh, {"auto": not m, "confident": ok, "pack": pack, "cols": cols, "rows": rows})
        count += 1

# ---------------------------------------------------------------- raw copies for environments, UI, icons, NPCs (inspected in the lab, sliced in phase 4/5)
for pack in ("fm32x32", "resurected-rpg-tile", "pixel-ui-pack", "icon-pack-24x24", "skeletons-pack-1", "skeletons-pack-2", "goblin-sprite-pack", "lively-npcs"):
    base = os.path.join(P4, pack)
    if not os.path.isdir(base):
        continue
    for f in glob.glob(os.path.join(base, "**", "*.png"), recursive=True):
        rel = os.path.relpath(f, base)
        if "__MACOSX" in rel:
            continue
        rel = "/".join(re.sub(r"[^A-Za-z0-9._-]+", "_", part) for part in rel.replace(os.sep, "/").split("/"))   # no "#" or spaces in URLs
        dest = f"raw/{pack}/{rel}"
        os.makedirs(os.path.dirname(os.path.join(OUT, dest)), exist_ok=True)
        shutil.copy(f, os.path.join(OUT, dest))
        man["raw"].setdefault(pack, []).append({"file": "arena-assets/raw/" + pack + "/" + rel, "size": list(Image.open(f).size)})

json.dump(man, open(os.path.join(OUT, "manifest.json"), "w"), indent=1)
print(f"{len(man['sheets'])} character strips, {len(man['vfx'])} vfx sheets, {sum(len(v) for v in man['raw'].values())} raw images")
for k, v in man["vfx"].items():
    print(f"  {k:60s} {v['frames']:3d} x {v['frameW']}x{v['frameH']} grid {v['cols']}x{v['rows']}{'' if v['confident'] else '  ?? low confidence'}{'' if v['auto'] else '  (from name)'}")
