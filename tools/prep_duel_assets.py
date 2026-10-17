#!/usr/bin/env python3
"""Build public/duel-assets from the packs in assets/packs2 (Szadi hero + Shield Skeleton, Ninja Adventure tiles/audio).
Run:  python3 tools/prep_duel_assets.py     (output is gitignored: third-party art)"""
import glob, json, os, re, shutil, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P2 = os.path.join(ROOT, "assets", "packs2")
OUT = os.path.join(ROOT, "public", "duel-assets")
NA = os.path.join(P2, "ninja-adventure-asset-pack", "Ninja Adventure - Asset Pack")
HERO = os.path.join(P2, "hero-and-opponents-animation")

def nat(p):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", os.path.basename(p))]

if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)
manifest = {"sheets": {}, "audio": {}, "music": {}}

def strip(key, pattern, dest, anchor=None):
    files = sorted(glob.glob(pattern), key=nat)
    if not files:
        sys.exit(f"no frames for {key}: {pattern}")
    imgs = [Image.open(f).convert("RGBA") for f in files]
    fw, fh = imgs[0].size
    sheet = Image.new("RGBA", (fw * len(imgs), fh))
    for i, im in enumerate(imgs):
        sheet.paste(im, (i * fw, 0))
    os.makedirs(os.path.dirname(os.path.join(OUT, dest)), exist_ok=True)
    sheet.save(os.path.join(OUT, dest))
    boxes = [im.getbbox() for im in imgs if im.getbbox()]
    manifest["sheets"][key] = {
        "file": "duel-assets/" + dest, "frameW": fw, "frameH": fh, "frames": len(imgs),
        "bbox": [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)],
        "first": list(imgs[0].getbbox() or (0, 0, fw, fh)),
    }

# ---- hero (Szadi): body anchors come from the idle strip
H = os.path.join(HERO, "Player", "PNG")
hero = {
    "idle": "Idle/idle-with-weapon*.png", "walk": "walk-with-weapon*.png", "run": "Run/run*.png",
    "atkA": "Attacks/attack-A*.png", "atkB": "Attacks/attack-B*.png", "atkC": "Attacks/attack-C*.png", "atkD": "Attacks/attack-D*.png",
    "kick": "Attacks/kick*.png", "blockUp": "Shield Block/shield-block-activ*.png", "block": "Shield Block/shield-block-center*.png",
    "blockHigh": "Shield Block/shield-block-up*.png", "roll": "Roll/roll*.png", "hitA": "Hit/hit-with-weapon-A*.png",
    "hitB": "Hit/hit-with-weapon-B*.png", "dead": "Dead/dead*.png",
}
for k, pat in hero.items():
    strip(f"hero_{k}", os.path.join(H, pat), f"hero/{k}.png")

# ---- Shield Skeleton (Szadi enemy 2)
E = os.path.join(HERO, "2 Enemy", "PNG")
cap = {"idle": "idle-*.png", "walk": "walk-*.png", "atkA": "attack-A*.png", "atkB": "attack-B*.png", "hit": "hit-*.png",
       "dead": "dead-*.png", "block": "shield-block*.png", "jump": "jump-*.png"}
for k, pat in cap.items():
    strip(f"cap_{k}", os.path.join(E, pat), f"captain/{k}.png")

# ---- Mecha-Stone Golem (Darkpixel): a 10x10 grid of 100x100 cells; rows are animations
GOL = os.path.join(P2, "mecha-golem-free")
gdir = None
for root, _, fs in os.walk(GOL):
    if "Character_sheet.png" in fs:
        gdir = os.path.dirname(root)
if gdir is None:
    sys.exit("Mecha-stone Golem pack not found in assets/packs2")
sheet = Image.open(os.path.join(gdir, "PNG sheet", "Character_sheet.png")).convert("RGBA")

def grid_strip(key, cells, dest, cell=100):
    """cells: list of (col, row) in the 100x100 grid -> one horizontal strip."""
    frames = [sheet.crop((c * cell, r * cell, (c + 1) * cell, (r + 1) * cell)) for c, r in cells]
    out = Image.new("RGBA", (cell * len(frames), cell))
    for i, f in enumerate(frames):
        out.paste(f, (i * cell, 0))
    os.makedirs(os.path.dirname(os.path.join(OUT, dest)), exist_ok=True)
    out.save(os.path.join(OUT, dest))
    boxes = [f.getbbox() for f in frames if f.getbbox()]
    manifest["sheets"][key] = {
        "file": "duel-assets/" + dest, "frameW": cell, "frameH": cell, "frames": len(frames),
        "bbox": [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)],
        "first": list(frames[0].getbbox() or (0, 0, cell, cell)),
    }

row = lambda r, n: [(c, r) for c in range(n)]
grid_strip("golem_idle", row(0, 4), "golem/idle.png")
grid_strip("golem_glow", row(1, 8), "golem/glow.png")
grid_strip("golem_arm", row(2, 9), "golem/arm.png")
grid_strip("golem_block", row(3, 8), "golem/block.png")
grid_strip("golem_hit", [(1, 3), (2, 3), (3, 3), (2, 3)], "golem/hit.png")        # the start of the curl reads as a stagger
grid_strip("golem_melee", row(4, 7), "golem/melee.png")
grid_strip("golem_laser", row(5, 7), "golem/laser.png")
grid_strip("golem_armor", row(6, 10), "golem/armor.png")
grid_strip("golem_dead", row(7, 10) + row(8, 4), "golem/dead.png")

wp = os.path.join(gdir, "weapon PNG")
laser = Image.open(os.path.join(wp, "Laser_sheet.png")).convert("RGBA")       # 300x1500 = fifteen 300x100 frames; 9-14 are the beam
beam = Image.new("RGBA", (300 * 6, 100))
for i in range(6):
    beam.paste(laser.crop((0, (9 + i) * 100, 300, (10 + i) * 100)), (i * 300, 0))
os.makedirs(os.path.join(OUT, "fx"), exist_ok=True)
beam.save(os.path.join(OUT, "fx", "beam.png"))
manifest["sheets"]["fx_beam"] = {"file": "duel-assets/fx/beam.png", "frameW": 300, "frameH": 100, "frames": 6, "bbox": [30, 11, 300, 55], "first": [30, 11, 300, 55], "originX": 40, "originY": 33}
glow = Image.open(os.path.join(wp, "arm_projectile_glowing.png")).convert("RGBA")   # 3x2 grid of 100x100
fist = Image.new("RGBA", (600, 100))
for i in range(6):
    fist.paste(glow.crop(((i % 3) * 100, (i // 3) * 100, (i % 3) * 100 + 100, (i // 3) * 100 + 100)), (i * 100, 0))
fist.save(os.path.join(OUT, "fx", "fist.png"))
manifest["sheets"]["fx_fist"] = {"file": "duel-assets/fx/fist.png", "frameW": 100, "frameH": 100, "frames": 6, "bbox": [60, 30, 95, 44], "first": [60, 30, 95, 44]}

# ---- tileset: Ninja Adventure TilesetRelief (orange): plateau 4x3 + cliff face 3x3 -> 7x3
relief = Image.open(os.path.join(NA, "Backgrounds", "Tilesets", "TilesetRelief.png")).convert("RGBA")
tiles = Image.new("RGBA", (7 * 16, 3 * 16))
tiles.paste(relief.crop((0, 5 * 16, 4 * 16, 8 * 16)), (0, 0))        # plateau: cols 0-3
tiles.paste(relief.crop((4 * 16, 5 * 16, 7 * 16, 8 * 16)), (4 * 16, 0))  # tall cliff: cols 4-6
os.makedirs(os.path.join(OUT, "tiles"))
tiles.save(os.path.join(OUT, "tiles", "duel_tiles.png"))
manifest["tiles"] = {"file": "duel-assets/tiles/duel_tiles.png", "cols": 7, "rows": 3}

# ---- audio (Ninja Adventure, CC0)
S = os.path.join(NA, "Audio", "Sounds")
picks = {
    "swing1": "Whoosh & Slash/Slash.wav", "swing2": "Whoosh & Slash/Slash2.wav", "swing3": "Whoosh & Slash/Slash3.wav",
    "swing4": "Whoosh & Slash/Slash4.wav", "swing5": "Whoosh & Slash/Slash5.wav", "whoosh": "Whoosh & Slash/Whoosh.wav",
    "whoosh2": "Whoosh & Slash/Whoosh2.wav", "sword": "Whoosh & Slash/Sword2.wav",
    "hit1": "Hit & Impact/Hit1.wav", "hit2": "Hit & Impact/Hit2.wav", "hit3": "Hit & Impact/Hit3.wav", "hit5": "Hit & Impact/Hit5.wav",
    "impact1": "Hit & Impact/Impact.wav", "impact2": "Hit & Impact/Impact2.wav", "impact3": "Hit & Impact/Impact3.wav",
    "impact4": "Hit & Impact/Impact4.wav", "impact5": "Hit & Impact/Impact5.wav",
    "heal": "Magic & Skill/Heal.wav", "heal2": "Magic & Skill/Heal2.wav", "magic1": "Magic & Skill/Magic1.wav",
    "alert1": "Alert/Alert.wav", "alert2": "Alert/Alert2.wav", "alert3": "Alert/Alert3.wav",
    "voice1": "Voice/Voice1.wav", "voice2": "Voice/Voice2.wav", "voice3": "Voice/Voice3.wav",
    "boom": "Elemental/Explosion.wav", "boom2": "Elemental/Explosion2.wav",
}
os.makedirs(os.path.join(OUT, "audio"))
for k, rel in picks.items():
    shutil.copy(os.path.join(S, rel), os.path.join(OUT, "audio", k + ".wav"))
    manifest["audio"][k] = f"duel-assets/audio/{k}.wav"
for k, name in {"fight": "17 - Fight.ogg", "explore": "10 - Dark Castle.ogg"}.items():
    shutil.copy(os.path.join(NA, "Audio", "Musics", name), os.path.join(OUT, "audio", k + ".ogg"))
    manifest["music"][k] = f"duel-assets/audio/{k}.ogg"

json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), indent=1)
print(f"ok: {len(manifest['sheets'])} sheets, {len(manifest['audio'])} sfx -> {OUT}")
