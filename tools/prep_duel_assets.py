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

# ---- grunts (Szadi enemies 1 and 4): sword skeleton "sk", spear skeleton "sp"
for prefix, folder in (("sk", "1 Enemy"), ("sp", "4 Enemy")):
    ED = os.path.join(HERO, folder, "PNG")
    for k, pat in {"idle": "idle-*.png", "walk": "walk-*.png", "atkA": "attack-A*.png", "atkB": "attack-B*.png", "hit": "hit-*.png", "dead": "dead-*.png"}.items():
        strip(f"{prefix}_{k}", os.path.join(ED, pat), f"grunts/{prefix}/{k}.png")

# ---- Bringer of Death (final boss): frames are 140x93, the scythe skews the box, so the scene passes anchorX; art faces LEFT
BOD = os.path.join(ROOT, "assets", "packs", "bringer-of-death-free__Bringer-Of-Death", "Bringer-Of-Death", "Individual Sprite")
if os.path.isdir(BOD):
    for k, d in {"idle": "Idle", "walk": "Walk", "atkA": "Attack", "cast": "Cast", "hit": "Hurt", "dead": "Death"}.items():
        strip(f"bod_{k}", os.path.join(BOD, d, "*.png"), f"bringer/{k}.png")
    strip("bod_block", os.path.join(BOD, "Cast", "Bringer-of-Death_Cast_[1-5].png"), "bringer/block.png")   # the hunched start of the cast reads as a guard
    strip("fx_spell", os.path.join(BOD, "Spell", "*.png"), "fx/spell.png")
else:
    print("note: Bringer of Death pack not found - the final boss will be missing")

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

# ---- VFX (all white-on-transparent except the heal sparkle, so they can be tinted at runtime)
#   v-ktor "Pixelated Attack/Hit Animations" (CC-BY 4.0), Pimen "Smoke VFX 1" and "Cutting and Healing" (credit Pimen).
def find_file(pack, name):
    for root, _, fs in os.walk(os.path.join(P3, pack)):
        if name in fs:
            return os.path.join(root, name)
    sys.exit(f"missing {name} in packs3/{pack} - download the VFX packs (see tools/README.md)")

def vfx_strip(key, pack, name, fw, fh, cols, n):
    img = Image.open(find_file(pack, name)).convert("RGBA")
    frames = [img.crop(((i % cols) * fw, (i // cols) * fh, (i % cols) * fw + fw, (i // cols) * fh + fh)) for i in range(n)]
    out = Image.new("RGBA", (fw * n, fh))
    for i, f in enumerate(frames):
        out.paste(f, (i * fw, 0))
    os.makedirs(os.path.join(OUT, "vfx"), exist_ok=True)
    out.save(os.path.join(OUT, "vfx", key + ".png"))
    manifest["sheets"]["vfx_" + key] = {"file": f"duel-assets/vfx/{key}.png", "frameW": fw, "frameH": fh, "frames": n, "bbox": [0, 0, fw, fh], "first": [0, 0, fw, fh]}

P3 = os.path.join(ROOT, "assets", "packs3")
VK = "pixelated-attackhit-animations"
vfx_strip("hit01", VK, "hit01.png", 64, 64, 5, 10)      # streaks
vfx_strip("hit03", VK, "hit03.png", 64, 64, 5, 10)      # starburst
vfx_strip("hit05", VK, "hit05.png", 64, 64, 5, 10)      # curved slash arcs
vfx_strip("impact01", VK, "impact01.png", 64, 64, 11, 11)  # growing shock ring
vfx_strip("break01", VK, "break01.png", 64, 64, 11, 11)    # X burst
vfx_strip("blood", VK, "blood.png", 64, 64, 8, 8)
vfx_strip("shards", VK, "shards01.png", 64, 64, 5, 10)
vfx_strip("splash", VK, "splash01.png", 64, 64, 5, 10)
vfx_strip("smoke", "smoke-vfx-1", "Smoke VFX 2.png", 64, 64, 13, 13)
vfx_strip("heal", "cutting-and-healing", "Heal Effect Sprite Sheet.png", 128, 128, 4, 16)

# ---- tileset: Ninja Adventure TilesetRelief (orange): plateau 4x3 + cliff face 3x3 -> 7x3
relief = Image.open(os.path.join(NA, "Backgrounds", "Tilesets", "TilesetRelief.png")).convert("RGBA")
tiles = Image.new("RGBA", (7 * 16, 3 * 16))
tiles.paste(relief.crop((0, 5 * 16, 4 * 16, 8 * 16)), (0, 0))        # plateau: cols 0-3
tiles.paste(relief.crop((4 * 16, 5 * 16, 7 * 16, 8 * 16)), (4 * 16, 0))  # tall cliff: cols 4-6
os.makedirs(os.path.join(OUT, "tiles"))
tiles.save(os.path.join(OUT, "tiles", "duel_tiles.png"))
manifest["tiles"] = {"file": "duel-assets/tiles/duel_tiles.png", "cols": 7, "rows": 3}

# ---- audio. Sword clashes/swings: OpenGameArt "sword" + "sword clash" by StarNinjas (CC0), normalised to a common loudness.
# Everything else (thuds, whooshes, warning cues, heals) is synthesised at runtime in game/duel/sfx.ts.
import subprocess
os.makedirs(os.path.join(OUT, "audio"))
P3 = os.path.join(ROOT, "assets", "packs3")
def convert(src, key):
    dst = os.path.join(OUT, "audio", key + ".wav")
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af", "loudnorm=I=-19:TP=-3:LRA=7,aformat=sample_fmts=s16:channel_layouts=mono", "-ar", "44100", dst])
    if r.returncode != 0:
        sys.exit(f"ffmpeg failed on {src}")
    manifest["audio"][key] = f"duel-assets/audio/{key}.wav"
clashes = sorted(glob.glob(os.path.join(P3, "oga-clash", "*.ogg")), key=nat)
blades = sorted(glob.glob(os.path.join(P3, "oga-swords", "*", "*.ogg")), key=nat)
if len(clashes) != 10 or len(blades) != 10:
    sys.exit("missing sword samples in assets/packs3 - see tools/README.md (fetch_sfx.sh)")
for i, f in enumerate(clashes, 1):
    convert(f, f"clash{i}")
for i, f in enumerate(blades, 1):
    convert(f, f"blade{i}")

# ---- music (Ninja Adventure, CC0). Tempo and first-beat phase are measured by tools/bpm.py so combat can be phase-locked to the track.
sys.path.insert(0, os.path.join(ROOT, "tools"))
import bpm as bpmtool
TRACKS = {
    "temple": "12 - Temple.ogg",          # tutorial / exploring (90 BPM)
    "castle": "10 - Dark Castle.ogg",     # quieter exploring (65 BPM)
    "captain": "17 - Fight.ogg",          # boss 1 (90 BPM)
    "crypt": "40 - Crypt.ogg",            # boss 2 (80 BPM)
    "final": "24 - Final Area.ogg",       # final boss (70 BPM)
}
for k, name in TRACKS.items():
    src = os.path.join(NA, "Audio", "Musics", name)
    shutil.copy(src, os.path.join(OUT, "audio", k + ".ogg"))
    r = bpmtool.analyse(src)
    manifest["music"][k] = {"file": f"duel-assets/audio/{k}.ogg", "bpm": r["bpm"], "phase": r["phase"], "conf": r["conf"], "seconds": r["seconds"]}
    print(f"  music {k:8} {r['bpm']:6.2f} BPM  phase {r['phase']:.3f}s  conf {r['conf']}")

json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), indent=1)
print(f"ok: {len(manifest['sheets'])} sheets, {len(manifest['audio'])} sfx -> {OUT}")
