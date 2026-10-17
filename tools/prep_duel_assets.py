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
