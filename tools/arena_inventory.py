#!/usr/bin/env python3
"""Phase 0 inventory for the v4 packs in assets/packs4: every animation folder (numbered PNG frames) with canvas size, frame count
and union bbox. Prints a table per pack; with --json writes the dict. Run: python3 -I tools/arena_inventory.py [pack-substring ...]"""
import glob, json, os, re, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P4 = os.path.join(ROOT, "assets", "packs4")

def nat(p):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", os.path.basename(p))]

def inventory(pack):
    dirs = {}
    for f in glob.glob(os.path.join(P4, pack, "**", "*.png"), recursive=True):
        if re.search(r"_\d+\.png$", f, re.I) or re.search(r"\d+\.png$", f):
            dirs.setdefault(os.path.dirname(f), []).append(f)
    out = []
    for d, fs in sorted(dirs.items()):
        fs.sort(key=nat)
        ims = [Image.open(f).convert("RGBA") for f in fs]
        boxes = [b for b in (i.getbbox() for i in ims) if b]
        if not boxes:
            continue
        out.append({"dir": os.path.relpath(d, os.path.join(P4, pack)), "frames": len(fs), "canvas": list(ims[0].size),
                    "bbox": [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]})
    return out

if __name__ == "__main__":
    want = [a for a in sys.argv[1:] if not a.startswith("--")]
    res = {}
    for pack in sorted(os.listdir(P4)):
        if want and not any(w in pack for w in want):
            continue
        res[pack] = inventory(pack)
        print(f"== {pack}")
        for a in res[pack]:
            print(f"  {a['frames']:3d}f {a['canvas'][0]}x{a['canvas'][1]} bbox{a['bbox']}  {a['dir'].split('/')[-1]}")
    if "--json" in sys.argv:
        json.dump(res, open(os.path.join(ROOT, "assets", "packs4_inventory.json"), "w"), indent=1)
