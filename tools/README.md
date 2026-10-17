# Asset pipeline

The art is third-party (itch.io) and **not committed** - `assets/` and `public/game-assets/` are gitignored. Bringer of Death's licence forbids redistribution; the others are CC0.

| Pack | Author | Used for |
|---|---|---|
| Hero Knight 2 | Luiz Melo (CC0) | player |
| Monsters Creatures Fantasy 2 (Slime) | Luiz Melo | boss 1 |
| Fire Worm | Luiz Melo (CC0) | boss 2 |
| Evil Wizard 3 | Luiz Melo | boss 3 |
| Bringer of Death (free) | Clembod (no redistribution) | boss 4 |
| Tiny Platformer - Hills | Luiz Melo (CC0) | tileset + backgrounds |

```bash
npm i                                    # includes playwright
npx playwright install chromium
npm run assets:download                  # fetches the zips into assets/_dl
cd assets && mkdir -p packs && for z in _dl/*/*.zip; do n=$(basename "$(dirname "$z")")__$(basename "$z" .zip | tr ' ' '_'); mkdir -p "packs/$n" && unzip -q -o "$z" -d "packs/$n"; done; cd ..
npm run assets                           # slices strips + manifest.json, cuts the tileset, writes the Tiled maps
```

`prep_assets.py` measures every sprite's real bounding box (used for hurtboxes) and re-cuts the source tileset (it sits on a 1px offset grid) onto a clean 16px grid.
`make_maps.py` writes `public/maps/arena_N.json` - open those in [Tiled](https://www.mapeditor.org). Layers: `ground` (solid), `platforms` (one-way), `spawns` (object layer: `player`, `boss`).

## Posture Duel (`/duel`)

| Pack | Author | Licence | Used for |
|---|---|---|---|
| Hero and Opponents | Szadi art | edit and use freely, no resale | hero + Shield Skeleton |
| Ninja Adventure | pixel-boy | CC0 | cliff tiles, 2 music tracks |
| Pixelated Attack/Hit Animations | v-ktor | CC BY 4.0 | hit sparks, impact rings, shards, blood (tinted at runtime) |
| Smoke VFX 1, Cutting and Healing | Pimen | credit the author | dust puffs, heal sparkle |
| Sword + Sword Clash sounds | StarNinjas (OpenGameArt) | CC0 (credit requested) | recorded sword swings and clashes; everything else in `sfx.ts` is synthesised |
| Mecha-Stone Golem | Darkpixel | none stated | boss 2 |

```bash
npm run assets:download:duel                       # fetches into assets/_dl2
cd assets && mkdir -p packs2 && for f in _dl2/*/*.zip _dl2/*/*.rar; do n=$(basename "$(dirname "$f")"); mkdir -p "packs2/$n" && bsdtar -x -f "$f" -C "packs2/$n"; done; cd ..
sh tools/fetch_sfx.sh                              # 20 CC0 sword sounds (OpenGameArt, StarNinjas) into assets/packs3
npm run assets:duel                                # strips + manifest, repacked tileset, audio, public/maps/duel_arena.json
```

`prep_duel_assets.py` derives each sprite's foot anchor from its idle frame so characters stand on their `(x, y)` position and flip cleanly.
`make_duel_map.py` writes the 80x60 Tiled map (layers `ground`, `walls`, `objects` with `player`/`boss` spawns, `gate` and an `arena` rect that locks the camera).

## Balance harness

`node tests/duel/bot.mjs captain,golem,bringer 2 classic|beat` (needs `npm run dev`): a scripted player at three skill levels (novice, competent, expert) fights each boss against the rules brain and prints win rate, fight length and lowest HP. It is a crude stand-in for a human, so read it as a relative signal. Current shape: the Bringer in beat mode is lost by novices in life 2, reached to life 3 by competent bots and beaten by expert bots.
