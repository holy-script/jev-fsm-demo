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
