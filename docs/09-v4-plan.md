# 09. v4 plan: "ARENA" proper demo

Status: **Phases 0 (assets, section 9) and 1 (engine kernel, section 10) done.** Phase 2 (combat depth, QTE) next. Decisions taken with the user: free assets only; v4 is a new route `/arena` in `game/v4/` (v3 `/duel` stays untouched and playable); the setting follows the environment packs (forest, ruined river temple, graveyard), so the v3 monastery/foundry/summit story is rewritten.

Goal: a polished 10 to 15 minute demo where Jev is visibly the enemy's brain, with a consistent art style, better environments, richer combat (combos, reverse-animation parries, quick-time events) and a real UI.

## 1. Asset sources and what is actually free

All three creators are on itch.io. Licences: chierit CC BY 4.0 (credit, no resale); immunitys edit freely, **no redistribution** (fits our never-commit-art rule); pimen credit the author. Add all three to `MenuScene`-style Credits and `tools/README.md`.

### chierit characters (free zips, verified from the itch pages on 2026-10-17)

| Pack | Free zip contents | Role in v4 |
|---|---|---|
| Fire Knight | idle run jump air_atk roll 1_atk 2_atk 3_atk sp_atk defend take_hit death | **Player** (fire theme, matches the pimen fire VFX). Needs v1.1 free zip |
| Metal Bladekeeper | the above plus projectile, trap, j_up/j_down | Boss 1 (blades, traps, thrown projectile) |
| Crystal Mauler | idle run jump_up/down air_atk roll 3 atks sp_atk defend take_hit death | Boss 2 (heavy, slow, big sp_atk) |
| Wind Hashashin | same shape, jump_up/down, slide | Boss 3 (fast, evasive) |
| Water Priestess | idle walk surf jump air_atk tumble 3 atks sp_atk **heal** defend take_hit death | Boss 4 or ranged mini-boss (heals, zones) |
| Ground Monk | idle run jump air_atk 3 atks sp_atk **meditate** roll defend take_hit death | Mini-boss or Jev "Echo" donor |
| Leaf Ranger | idle run jump air_atk roll slide 3 atks sp_atk defend take_hit death | Opening encounter (ranged) |
| Free Cthulu | idle walk fly 1atk 2atk hurt death | Grunt/flyer |
| Demon Slime (free) | idle walk cleave take_hit death | Grunt/mini-boss (only 5 anims) |

Paid-only, **not used**: Shadow Stalker, Light Valkyrie, Lightning Ronin, every "Elemental Mode" (e_*) set, Minotaur (free = 3 anims), Poison Wyrm, Frost Guardian (free = 5 anims).

Final boss without a paid pack: **"Echo"**, a palette-swapped Fire Knight (the player's mirror). Jev is given the boss-memory of how the player fought (see v3 boss memory, doc 05 and 02) and picks counters. It is thematically strong and costs no art.

The open risks listed here at planning time are resolved in section 9.

### immunitys environments
Free name-your-price (verify each): Forgotten Memories 32x32 (autumn forest, river, waterfall, stone paths), Forest Top-Down 32x32, Pixel RPG UI Pack, RPG Icon Pack 32x32/24x24, Top Down Skeletons #1/#2, Goblin Sprite Pack #1.
**Resolved in Phase 0: the skeleton/goblin packs are not usable as enemies** (32x32 top-down, idle and walk in four directions only, weapons as separate overlay sheets, no attack/hit/death). Grunts come from Cthulu, Demon Slime and Frost Guardian (free: idle walk 1_atk take_hit death) instead. Tilesets are forest/ruins only; no foundry or lava. Areas are therefore: Forest Edge, River Shrine (water, waterfall), Ruined Graveyard/Temple, and a night or dusk variant of one of them for the final.

### Reuse from v3
Ninja Adventure music (5 tracks, beat-analysed), sword clash/swing sounds (CC0), v-ktor hit sparks (CC BY), Pimen smoke/heal. Szadi, Darkpixel and Clembod art are dropped in v4, which removes the mixed-art look and the no-redistribution worry from Bringer.

## 2. Architecture

New code in `game/v4/` (copy the data-driven shape of `game/duel/`: `data.ts`, `engine.ts`, `brain.ts`, `skills.ts`, `ArenaScene.ts`, `HudScene.ts`, `MenuScene.ts`). Reuse as-is by import: `lib/` Jev client, `game/duel/brain.ts` plumbing and fallback pattern, `sfx.ts`, `settings.ts` (new storage key). New asset prep `tools/prep_arena_assets.py` writes `public/arena-assets/` (gitignored). New route `app/arena/`. A new `tests/arena/` Playwright set cloned from `tests/duel/` helpers.

Do not edit `game/duel/` except to extract shared helpers into `game/shared/` when a copy would otherwise drift; v3 tests must keep passing.

## 3. Animation system (the headline feature)

v3 plays strips forward at fixed fps. v4 needs a small animation layer (`game/v4/anim.ts`):

- **Playback modes**: forward, **reverse**, ping-pong, hold-on-frame, scrub by progress (0..1), per-frame durations (hit-stop, anticipation holds).
- **Reverse parry**: on a perfect deflect, the attacker's attack animation is played backwards from the frame it reached to frame 0 over about 250 ms (reads as being thrown back), with hit-stop, a pimen spark and screen kick. The defender plays `defend` forward and holds. Regular deflect uses `take_hit` stagger; perfect uses reverse.
- **Combos (player)**: chain `1_atk` -> `2_atk` -> `3_atk` with a cancel window per frame range (data: `cancelFrom`, `cancelTo`), input buffering, and a finisher `sp_atk` that costs spirit. Each hit has damage and posture values; the third hit is a heavy.
- **Combos (enemy)**: bosses chain their own 1/2/3 attacks. Jev branches at *gates* between hits (continue, delay, feint, end), the mechanism v3 already has (doc 05 section 7, "Gates"). Feints use scrub or hold: stop at the wind-up frame and reverse.
- **Quick-time events** (`game/v4/qte.ts`), three kinds, all input-light and beat-aware:
  1. *Deathblow*: when a boss is staggered, a 2 to 3 prompt sequence (direction or button) within a time window decides finisher quality (clean finisher vs scuffed, extra damage).
  2. *Perilous counter*: the existing perilous glyph becomes a short timing ring; hit it for a free counter instead of a plain deflect.
  3. *Clash*: when player and boss attacks collide on the same beat, a button-mash/hold mini clash decides who staggers.
  QTEs must be skippable (setting) and have a rules fallback.

## 4. VFX and skills

- Basic combat feedback: Pimen **Slashes and Thrusts** (per attack smear), **Hit Spark** (impacts), plus v-ktor sparks already in v3.
- Elements: each chierit character gets a matching pimen pack for its `sp_atk` and one signature move (Fire 01/02/03 for the player, Dark/Holy/Thunder for bosses, Water/Wind/Earth/Wood if free). Skills (shrine) map to elements: ember dash, fire wave, parry shield (buff pack), heal.
- All VFX are plain spritesheets spawned by a `vfx.ts` that supports tint, additive blend, follow-target and reverse. Keep them data-driven (`vfxDef` in `data.ts`).

## 5. Gameplay structure (demo run, about 12 minutes)

1. **Title**, then **tutorial** in the Forest Edge using a ghost instructor (the Echo palette). Lessons: move, light chain, block, parry (forward), perfect parry (reverse), roll, posture break, QTE deathblow, skill use. 10 to 12 lessons, reuse the v3 tutorial engine.
2. **Forest Edge**: Leaf Ranger (ranged opener, rules brain or Jev).
3. **River Shrine**: Metal Bladekeeper (boss 1), shrine, skill points.
4. **Graveyard**: Crystal Mauler (boss 2), then Wind Hashashin (boss 3).
5. **Final**: Echo (mirror of the player, Jev reads the player's recorded habits). Ending sequence (cutscene cards, stats, Jev-vs-rules summary, New Game+).

Every boss has a Jev persona and a rules fallback; `F` toggles bot, `Tab` shows the log, as in v3.

## 6. UI/UX

- Pixel RPG UI pack for frames, bars and menus; RPG icons for skills and items.
- HUD: segmented health, posture bar, spirit, boss bar with name, combo counter, QTE overlay, input hints that adapt to keyboard or gamepad.
- **Jev panel** (always available, not only on Tab): current decision, reason, latency, source (Jev or fallback), plus a running Jev-vs-rules comparison. This is the product's point, so it gets first-class UI.
- Title, pause, settings (volume, timing mode, QTE assist, screen shake, flash), **key rebinding and gamepad**, save slots, credits.
- Area title cards, subtle camera work (look-ahead, zoom on kills, kick on parry), per-area ambient light and parallax.

## 7. Phases (each ends with tsc clean, tests green, a commit and push)

| Phase | Deliverable | Exit check |
|---|---|---|
| 0 Assets | Download free zips with the Playwright script, inspect sizes and frame counts, write `prep_arena_assets.py` and manifest, resolve the top-down enemy question and the free pimen list | A throwaway scene shows every needed animation playing |
| 1 Engine | `game/v4/` skeleton: movement, combat model carried from v3, new anim layer (reverse, scrub, per-frame timing), Fire Knight playable on a flat test map | Reverse parry visible; combo chain works with input buffer |
| 2 Combat depth | Combo data, cancel windows, QTE system, element VFX hookup | Suite `combat-v4` passes |
| 3 Bosses and Jev | Boss data for each chierit boss, Jev question types (reuse pattern from doc 02), fallbacks, taunts, Echo boss memory | Per-boss suite passes; `bot.mjs` balance glance |
| 4 World | Tiled maps from immunitys tilesets, parallax and lighting, areas, shrine, story rewrite | World suite passes; screenshots reviewed |
| 5 UI/UX | New HUD, Jev panel, menus, rebinding, gamepad, saves, ending | Manual walkthrough plus UI suite |
| 6 Polish | Balance pass, human play-test, perf (lighting at low res), docs update (new 05-style doc, update README/AGENTS), credits | Full chain green |

Game feel can only be judged by a human; plan a play-test after Phase 2 and again after Phase 5, and treat their feedback as the main input to tuning.

## 8. Rules of engagement (carry over from v3)

Jev picks, the engine executes; every Jev call has a fallback; never block the game on the network; never commit `.env`, `assets/`, `public/*-assets/` or `links.txt`; never print the API key; do not edit game code while a long Playwright run is in progress; commit and push after each coherent change.

## 9. Phase 0 results (2026-10-17)

**Pipeline.** `npm run assets:download:arena` (`tools/itch_download.mjs arena`, into `assets/_dl4`), unzip/unrar with `bsdtar` into `assets/packs4/<slug>/<zip>/`, then `npm run assets:arena` (`tools/prep_arena_assets.py`, writes `public/arena-assets/`, gitignored). `tools/itch_survey.mjs` lists what an itch page offers without downloading (use it before adding any pack; pages needing payment show no download button). `tools/arena_inventory.py` prints every animation folder with canvas, frame count and bbox. Check output visually in the lab: **`/arena/lab`** (characters with forward/reverse/ping-pong playback and a scrubber, all VFX, raw tile/UI images).

**Downloaded and verified free:** all 7 chierit Elementals human sets (Fire Knight, Metal Bladekeeper, Crystal Mauler, Wind Hashashin, Water Priestess, Ground Monk, Leaf Ranger), Free Cthulu, Demon Slime free, Frost Guardian free, Lively NPCs; **24 pimen packs** (every element: fire 1+2, water 1+2, ice 1, thunder 1+2, earth 1+2, wind 1+2, wood, acid, dark, holy, plus hit spark, slashes and thrusts, smoke 1+3, halloween, magical animation pack, thrust, cutting and healing; the 18 buff/debuff packs, mega packs, explosions and projectiles, ice 2, smoke 2/4, and the "03" element packs are paid); immunitys Forgotten Memories 32x32 tileset (autumn forest, river, cliffs, waterfall, bridges), Resurrected RPG forest tileset, Pixel RPG UI pack (parchment/book/scroll style), icons 24 and 32. Seven itch pages timed out on a second download button (rar and zip duplicates); the first file arrived, nothing needed is missing except pimen "Effects" (pixel-battle-effects) and Heal/Gameboy sheets.

**Character data (frames per animation; canvas 288x128, sprite about 45 px tall, so render at 3x):**

| Pack | Chain | Special and extras |
|---|---|---|
| Fire Knight (fk) | 1_atk 11, 2_atk 19, 3_atk 28 | sp_atk 18, air_atk 8, roll 8, defend 10, take_hit 6, death 13, run 8, jump |
| Metal Bladekeeper (mb) | 6, 8, 18 | sp_atk 11, projectile_cast 7 + land 5, trap_cast 10 + land/detonate, defend 12 |
| Crystal Mauler (cm) | 7, 7, 17 | sp_atk 15, defend 9, take_hit 6, death 15 |
| Wind Hashashin (wh) | 8, 18, 26 | sp_atk 30, roll 6, death 19 |
| Water Priestess (wp) | 7, 21, 27 | sp_atk 32, heal 12, surf, tumble, defend 12 |
| Ground Monk (gm) | 6, 12, 23 | sp_atk 25, meditate 16, defend 13 |
| Leaf Ranger (lr) | 10, 15, 12 | sp_atk 17, arrow_shower 18, arrow hit/entangle/poison effects, slide, defend 19 |
| Cthulu (cth) | 1atk 7, 2atk 9 | fly, hurt 5, death 11 (canvas 192x112) |
| Demon Slime (dsl) | cleave 15 | idle walk take_hit death 22 (canvas 288x160) |
| Frost Guardian (fg) | 1_atk 14 | idle walk take_hit death (canvas 192x128) |

All 3 attacks have a visible wind-up and the third hit is long (17 to 28 frames), which suits combo finishers and the reverse-parry (a clean wind-up frame range exists to scrub). Frame counts differ a lot between characters, so every move must carry its own `windupFrames`, `activeFrames`, `recoverFrom` in data (measured per sheet) rather than a global timing.

**VFX slicing.** Pimen sheets carry no frame metadata. `detect_grid` takes the finest clean cut (every cell boundary only crosses transparent pixels), uses aspect ratio to pick rows, and falls back to a nearest-square divisor when frames touch (Halloween 2, the "w blur" thunder sheets). 101 sheets are written with `cols`/`rows`/`frames` and a `confident` flag. About a third are flagged only because the last cell is empty (harmless); the hit sparks, smears, fire, acid, dark, holy, thunder and ice sheets used first were checked by eye and are right. Anything odd found later: add an override table entry in `prep_arena_assets.py` rather than hand-editing output. The blur and "wo blur" thunder pairs are duplicates (keep wo blur).

**Decisions confirmed.** Player = Fire Knight. Immunitys skeletons/goblins dropped (see section 1). UI = parchment style, which suits a quiet forest-ruins tone. Environments: Forgotten Memories 32x32 for the river/forest/cliff areas (water is 6-frame animated), Resurrected RPG for grass/plants/portal.

**Credits to add before shipping:** chierit (CC BY 4.0), pimen, immunitys (named in the Credits screen).

**Phase 0 exit check:** met. The lab shows every needed character animation, forward and reversed, and the VFX sheets, with correct slicing for the first-use effects.

## 10. Phase 1 results: the engine kernel (route `/arena`, `game/v4/`)

Playable: Fire Knight vs a Metal Bladekeeper training enemy on a flat floor (`/arena`, add `?dev=1` for the debug line). Controls: WASD move, J or click attack, Space/K guard, Shift/L roll, R reset, dev P (toggle enemy AI), O/I (force enemy SLASH/TWIN). Suite: `npm run test:arena` (18 checks, needs `npm run dev`). View is 960x540, sprites at SCALE 2 (hero about 90 px).

| File | Role |
|---|---|
| `anim.ts` | `Animator`: plays a frame range of a sheet **forwards or backwards**, per-frame `holds` (extra ms on a frame: the telegraph), `speed` (0 = frozen for hit-stop), `reverseTo(frame, ms)` (rewinds what has played so far), `progress`. Pure logic. |
| `data.ts` | Constants and move tables: `HERO`, `HERO_ATTACKS` (L1, L2, L3), `HERO_CLIPS`, `ENEMY`, `ENEMY_ATTACKS` (SLASH, TWIN), `FX`. A `Clip` is `{sheet, from, to, fps, holds}`; a `HitDef` is `{a, b, dmg, posture, reach, band, kind}` with frames in sheet frame numbers. |
| `combat.ts` | Pure rules: `inReach` (forward ellipse, y is depth), `resolveEnemyHit` -> `dodged / deflected / blocked / hit / missed`, `pressGuard` (the anti-mash rule), `chip`. |
| `fighter.ts` | Sprite wrapper: owns an `Animator`, one foot anchor per character from the idle sheet, flip, tint flash, depth sort. |
| `vfx.ts` | One-shot pimen sprite effects by manifest key (tint, additive, flip, scale). |
| `ArenaScene.ts` | Player controller, enemy runner, hit resolution, feedback, HUD. State is plain objects (`scene.p`, `scene.e`, `scene.log`) so tests read it through `window.__arena`. |
| `createArenaGame.ts`, `manifest.ts` | Boot (loads every sheet in the manifest), game factory, manifest types. |

**Combo chain.** The three authored sheets share their first frames (1_atk is the first part of 2_atk, which is the first part of 3_atk), so a chain does not replay the wind-up: L1 = `fk_1_atk` 0-6, L2 = `fk_2_atk` 7-15 (the follow-through into the second swing), L3 = `fk_3_atk` 16-27 (into the fire finisher). A press is accepted from `chainFrom`; a press up to 150 ms *before* it is buffered; the chain continues when the clip ends. No continuation plays the recovery frames (`recover`). After the last damaging frame the player may cancel into roll or guard. This sheet-splicing trick is the pattern for every future combo: find the frame where one authored attack flows into the next.

**Reverse parry.** A guard press within `HERO.deflectMs` (160 ms) before the hit connects (and not inside `deflectSpamMs` of the previous press) is a *deflect*: the enemy's current clip is rewound with `anim.reverseTo(clip.from, 300ms)`, then it holds the staggered pose; blue spark and smear, hit-stop 120 ms, camera shake, enemy knocked back 34 px, +130% posture, and a riposte window (800 ms, x1.5 damage). Held guard is a *block* (chip 12%, posture to the player). Roll i-frames (40-300 ms) *dodge*. At 100 posture an enemy breaks: every hit is a deathblow (x2.5, stacks with riposte). Enemy swings are armoured (no flinch mid-attack) and a 1 s poise window stops stun-lock.

**Authoring a hit window.** Use the frame-index contact sheets: render the sheet's frames with indices (script pattern in the scratchpad this phase: crop each frame to the sheet bbox, label with the index) and pick `a..b` as the frames where the weapon smear is in front of the body. Mb attacks have a single wind-up frame 0 and strike at frame 1, so the telegraph is `holds: {0: 520}`. Hits resolve once, the first update in which the animation has reached frame `a` (so a coarse tick cannot skip a window).

**Known rough edges, deliberately left for later phases:** floor is a flat procedural grid (Phase 4), HUD is plain bars and text (Phase 5), the enemy has two attacks and a trivial approach/attack AI with no Jev yet (Phase 3), no sound (v3's `sfx.ts` will be reused), no QTE (Phase 2), bodies can overlap briefly after knockback, and deflecting the *second* hit of TWIN (a longer reverse) is not covered by a test yet.
